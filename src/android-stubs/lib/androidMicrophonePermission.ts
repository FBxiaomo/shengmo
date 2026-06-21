// Android microphone stub - macOS 构建（无运行时行为）
export function checkAndroidMicrophoneAccess(): boolean { return false; }
export function requestAndroidMicrophoneAccess(): Promise<boolean> { return Promise.resolve(true); }
