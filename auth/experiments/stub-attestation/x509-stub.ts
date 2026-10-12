// EXPERIMENT: `verifySignature` can verify with an X.509 certificate instead of a COSE key, which
// pulls in the ASN.1 certificate schema. A passkey is verified with its COSE key, never a certificate.
export const convertX509PublicKeyToCOSE = (): never => {
  throw new Error('X.509 public keys are stubbed out of this build')
}
