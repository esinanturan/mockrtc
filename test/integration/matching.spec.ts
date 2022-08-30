import {
    MockRTC,
    expect,
    delay,
    waitForState
} from '../test-setup';

describe("Connection rule matching", () => {

    const mockRTC = MockRTC.getRemote({ recordMessages: true });

    beforeEach(() => mockRTC.start());
    afterEach(() => mockRTC.stop());

    it("by default, matches and proxies all connections", async () => {
        const remoteConn = new RTCPeerConnection();
        const remotelyReceivedMessages: Array<string | Buffer> = [];

        remoteConn.addEventListener('datachannel', ({ channel }) => {
            channel.addEventListener('message', ({ data }) =>
                remotelyReceivedMessages.push(data)
            );
        });

        const matchingPeer = await mockRTC.getMatchingPeer();
        // No rules defined!

        // Create a local data connection:
        const localConn = new RTCPeerConnection();
        MockRTC.hookWebRTCConnection(localConn, matchingPeer); // Automatically redirect traffic via matchingPeer

        const dataChannel = localConn.createDataChannel("dataChannel");

        // Create a local offer (which will be hooked automatically):
        const localOffer = await localConn.createOffer();
        localConn.setLocalDescription(localOffer);

        // v-- Normally happens remotely, via signalling ---
        remoteConn.setRemoteDescription(localOffer);
        const remoteAnswer = await remoteConn.createAnswer();
        remoteConn.setLocalDescription(remoteAnswer);
        // ^-- Normally happens remotely, via signalling ---

        // Accept the real remote answer, and start communicating:
        localConn.setRemoteDescription(remoteAnswer);

        await new Promise<void>((resolve) => dataChannel.onopen = () => resolve());

        dataChannel.send('local message 1');
        dataChannel.send('local message 2');
        dataChannel.send('local message 3');

        await delay(100);

        // Traffic is passed through untouched, as expected:
        expect(remotelyReceivedMessages).to.deep.equal([
            'local message 1',
            'local message 2',
            'local message 3'
        ]);

        // But does go through the proxy:
        expect(await matchingPeer.getAllMessages()).to.deep.equal([
            'local message 1',
            'local message 2',
            'local message 3',
        ]);
    });

    it("can match data connections", async () => {
        // Explicitly hard-close media connections:
        await mockRTC.forMediaConnections()
            .thenClose();

        // Send a message on data channels only:
        await mockRTC.forDataConnections()
            .waitForChannel()
            .thenSend('bye');

        const matchingPeer = await mockRTC.getMatchingPeer();

        // Create a local data connection:
        const localConn = new RTCPeerConnection();

        const dataChannel = localConn.createDataChannel("dataChannel");

        const messagePromise = new Promise((resolve) => {
            dataChannel.addEventListener('message', ({ data }) => resolve(data));
        });

        const localOffer = await localConn.createOffer();
        await localConn.setLocalDescription(localOffer);
        const { answer } = await matchingPeer.answerOffer(localOffer);
        await localConn.setRemoteDescription(answer);

        // Wait until the matching handler sends the configured message:
        const receivedMessage = await messagePromise;
        expect(receivedMessage).to.equal('bye');
    });
});