/*
 * SPDX-FileCopyrightText: 2022 Tim Perry <tim@httptoolkit.tech>
 * SPDX-License-Identifier: Apache-2.0
 */

import { MockRTC, MockRTCEventData, MockRTCPeerBuilder } from "./mockrtc";
import { MockRTCPeer } from "./mockrtc-peer";
import { MockRTCHandlerBuilder } from "./handling/handler-builder";
import { HandlerStepDefinition } from "./handling/handler-step-definitions";
import {
    MatcherDefinition,
    HasAudioTrackMatcherDefinition,
    HasDataChannelMatcherDefinition,
    HasMediaTrackMatcherDefinition,
    HasVideoTrackMatcherDefinition
} from "./matching/matcher-definitions";

export abstract class MockRTCBase implements MockRTC {

    abstract getMatchingPeer(): MockRTCPeer;
    abstract start(): Promise<void>;
    abstract stop(): Promise<void>;
    abstract on<E extends keyof MockRTCEventData>(
        event: E,
        callback: (param: MockRTCEventData[E]) => void
    ): Promise<void>;

    buildPeer(): MockRTCPeerBuilder {
        return new MockRTCHandlerBuilder(this.buildPeerFromDefinition.bind(this));
    }

    abstract buildPeerFromDefinition(
        handlerStepDefinitions: HandlerStepDefinition[]
    ): Promise<MockRTCPeer>;

    abstract addRuleFromDefinition(
        matcherDefinitions: MatcherDefinition[],
        handlerStepDefinitions: HandlerStepDefinition[]
    ): Promise<void>;

    forDataConnections(): MockRTCHandlerBuilder<void> {
        return new MockRTCHandlerBuilder(
            this.addRuleFromDefinition.bind(this, [
                new HasDataChannelMatcherDefinition()
            ])
        );
    }

    forVideoConnections(): MockRTCHandlerBuilder<void> {
        return new MockRTCHandlerBuilder(
            this.addRuleFromDefinition.bind(this, [
                new HasVideoTrackMatcherDefinition()
            ])
        );
    }

    forAudioConnections(): MockRTCHandlerBuilder<void> {
        return new MockRTCHandlerBuilder(
            this.addRuleFromDefinition.bind(this, [
                new HasAudioTrackMatcherDefinition()
            ])
        );
    }

    forMediaConnections(): MockRTCHandlerBuilder<void> {
        return new MockRTCHandlerBuilder(
            this.addRuleFromDefinition.bind(this, [
                new HasMediaTrackMatcherDefinition()
            ])
        );
    }

}