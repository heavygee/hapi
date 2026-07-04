// Stub for IWER WebXR emulator packages (@iwer/sem, @iwer/devui, iwer).
//
// @pmndrs/xr ships an in-browser emulator (SEM + DevUI + IWER runtime) so you
// can poke at WebXR scenes from a regular tab. We test on real Quest hardware,
// so the emulator is dead code in production — and its ts-proto dependency
// pulls in @bufbuild/protobuf 2.x, conflicting with livekit-client's hoisted 1.x.
//
// In production builds all three packages are aliased here, which:
//   - removes ~6-8 MB from the bundle
//   - drops the @bufbuild/protobuf version conflict
//   - turns Cmd+Alt+E (the emulator hotkey baked into @pmndrs/xr) into a no-op
//
// In dev and test builds the real packages are used so IWER-based Playwright
// tests can emulate WebXR headsets. See docs/operator/garden/XR_E2E.md.

export default {}

export class DevUI {
    constructor() {}
}

export class SyntheticEnvironmentModule {
    constructor() {}
    loadDefaultEnvironment() { return Promise.resolve() }
    loadEnvironment() { return Promise.resolve() }
}

class StubXRDevice {
    install() {}
    installRuntime() {}
}

export class XRDevice extends StubXRDevice {}

export const metaQuest3 = {}
export const metaQuest2 = {}
export const metaQuestPro = {}
export const oculusQuest1 = {}
