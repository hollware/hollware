// EXPERIMENT, not part of the spike's answer: stands in for the attestation format verifiers of
// @simplewebauthn/server, so that a bundle can show how much of its weight is attestation code.
// Hollware asks for attestation "none" only, and "none" never reaches these functions.

const unsupported = (format: string) => (): Promise<boolean> =>
  Promise.reject(new Error(`Unsupported Attestation Format: ${format} (stubbed out of this build)`))

export const verifyAttestationPacked = unsupported('packed')
export const verifyAttestationAndroidSafetyNet = unsupported('android-safetynet')
export const verifyAttestationTPM = unsupported('tpm')
export const verifyAttestationAndroidKey = unsupported('android-key')
export const verifyAttestationApple = unsupported('apple')
export const verifyAttestationFIDOU2F = unsupported('fido-u2f')
