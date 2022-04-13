/*
 * SPDX-FileCopyrightText: 2022 Tim Perry <tim@httptoolkit.tech>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
    MockRTCExternalAnswerParams,
    MockRTCExternalOfferParams,
    MockRTCOfferParams
} from "./mockrtc-peer";
import type { MockRTCPeer } from "./mockrtc-peer";

import { MOCKRTC_CONTROL_CHANNEL } from "./webrtc/control-channel";

type OfferPairParams = MockRTCExternalOfferParams & { realOffer: RTCSessionDescriptionInit };
type AnswerPairParams = MockRTCExternalAnswerParams & { realAnswer: RTCSessionDescriptionInit };

export function hookWebRTCPeer(conn: RTCPeerConnection, mockPeer: MockRTCPeer) {
    // Anything that creates signalling data (createOffer/createAnswer) needs to be hooked to
    // return the params for the external mock peer.
    // Anything that sets params needs to be hooked to send to & set those params on the external
    // mock peer, create new params, signal those to the local mock peer.

    const _createOffer = conn.createOffer.bind(conn);
    const _createAnswer = conn.createAnswer.bind(conn);
    const _setLocalDescription = conn.setLocalDescription.bind(conn);
    const _setRemoteDescription = conn.setRemoteDescription.bind(conn);

    let pendingCreatedOffers: { [sdp: string]: OfferPairParams } = {};
    let pendingCreatedAnswers: { [sdp: string]: AnswerPairParams } = {};
    let selectedDescription: OfferPairParams | AnswerPairParams | undefined;

    let mockOffer: Promise<MockRTCOfferParams> | undefined;

    let internalAnswer: Promise<RTCSessionDescriptionInit> | undefined;

    // We create a control channel to communicate with MockRTC once the connection is set up.
    // That's created immediately, so its in the initial SDP, to avoid later negotation.
    const controlChannel = conn.createDataChannel(MOCKRTC_CONTROL_CHANNEL);
    new Promise<void>((resolve) => {
        controlChannel.onopen = () => resolve()
    }).then(() => {
        controlChannel.send(JSON.stringify({
            type: 'attach-external',
            id: selectedDescription!.id
        }));
    });

    conn.createOffer = (async (options: RTCOfferOptions) => {
        const realOffer = await _createOffer(options);
        const externalOfferParams = await mockPeer.createExternalOffer({
            mirrorSDP: realOffer.sdp!
        });
        const externalOffer = externalOfferParams.offer;
        pendingCreatedOffers[externalOffer.sdp!] = { ...externalOfferParams, realOffer };
        return externalOffer;
    }) as any;

    conn.createAnswer = (async (options: RTCAnswerOptions) => {
        await mockOffer; // If we have a pending offer, wait for that first - we can't answer without it.

        const realAnswer = await _createAnswer(options);
        const pendingAnswerParams = await mockPeer.answerExternalOffer(conn.pendingRemoteDescription!, {
            mirrorSDP: realAnswer.sdp
        });
        const externalAnswer = pendingAnswerParams.answer;
        pendingCreatedAnswers[externalAnswer.sdp!] = { ...pendingAnswerParams, realAnswer };
        return externalAnswer;
    }) as any;

    // Mock various props that expose the connection description:
    let pendingLocalDescription: RTCSessionDescriptionInit | null = null;
    Object.defineProperty(conn, 'pendingLocalDescription', {
        get: () => pendingLocalDescription
    });

    let currentLocalDescription: RTCSessionDescriptionInit | null = null;
    Object.defineProperty(conn, 'currentLocalDescription', {
        get: () => currentLocalDescription
    });

    Object.defineProperty(conn, 'localDescription', {
        get: () => conn.pendingLocalDescription ?? conn.currentLocalDescription
    });

    let pendingRemoteDescription: RTCSessionDescriptionInit | null = null;
    Object.defineProperty(conn, 'pendingRemoteDescription', {
        get: () => pendingRemoteDescription
    });

    let currentRemoteDescription: RTCSessionDescriptionInit | null = null;
    Object.defineProperty(conn, 'currentRemoteDescription', {
        get: () => currentRemoteDescription
    });

    Object.defineProperty(conn, 'remoteDescription', {
        get: () => conn.pendingRemoteDescription ?? conn.currentRemoteDescription
    });

    // Mock all mutations of the connection description:
    conn.setLocalDescription = (async (localDescription: RTCSessionDescriptionInit) => {
        if (!localDescription) {
            if (["stable", "have-local-offer", "have-remote-pranswer"].includes(conn.signalingState)) {
                localDescription = await conn.createOffer();
            } else {
                localDescription = await conn.createAnswer();
            }
        }

        // When we set an offer or answer locally, it must be the external offer/answer we've
        // generated to send to the other peer. We swap it back for a real equivalent that will
        // connect us to the mock peer instead:
        if (localDescription.type === 'offer') {
            pendingLocalDescription = localDescription;
            selectedDescription = pendingCreatedOffers[localDescription.sdp!];
            const { realOffer } = selectedDescription;

            // Start mock answer generation async, so it's ready/waitable in
            // setRemoteDescription if it's not complete by then.
            internalAnswer = mockPeer.answerOffer(realOffer)
                .then(({ answer }) => answer);
            await _setLocalDescription(realOffer);
        } else {
            selectedDescription = pendingCreatedAnswers[localDescription.sdp!];
            const { realAnswer } = selectedDescription;
            await _setLocalDescription(realAnswer);

            currentLocalDescription = localDescription;
            currentRemoteDescription = pendingRemoteDescription;
            pendingLocalDescription = null;
            pendingRemoteDescription = null;

            (await mockOffer!).setAnswer(realAnswer);
        }
    }) as any;

    conn.setRemoteDescription = (async (remoteDescription: RTCSessionDescriptionInit) => {
        if (remoteDescription.type === 'offer') {
            // We have an offer! Remember it, so we can createAnswer shortly.
            pendingRemoteDescription = remoteDescription;

            // We persist the mock offer synchronously, so we can check for it in createAnswer
            // and avoid race conditions where we fail to create an answer before this method
            // hasn't yet completed.
            mockOffer = mockPeer.createOffer({
                mirrorSDP: remoteDescription.sdp,
                addDataStream: true
            });

            await _setRemoteDescription((await mockOffer).offer);
        } else {
            // We have an answer - we must've sent an offer, complete & use that.
            await (selectedDescription as OfferPairParams).setAnswer(remoteDescription);
            await _setRemoteDescription(await internalAnswer!);

            currentLocalDescription = pendingLocalDescription;
            currentRemoteDescription = remoteDescription;
            pendingLocalDescription = null;
            pendingRemoteDescription = null;
        }
    }) as any;

    Object.defineProperty(conn, 'onicecandidate', {
        get: () => {},
        set: () => {} // Ignore this completely - never call the callback
    });
}