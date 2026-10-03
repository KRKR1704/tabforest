# Fixed extension key

Extension ID: `nldemblgfgcaolkpkajdbefjfnileeoi`

Public key (base64 DER, manifest `key`):

```text
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjdWh3hkU9XB7yXjzPY9+wl4rntbo3kundep6ySAG663zNsUd5JbMwrBH5BGpPtQirY2BScVGKqwFp0lmjAbVnYa2BNKI7o18I/HSnRHBVz9mUH1xYZKBdRLVTJj+f9OX469jNeKOuZQZW07SW6saJwCBanLE3S7QRfAM4EN+Q82SfCrPva2istkZO1Ts1lc0aIPydt4yAD/Hk24aC1TluEghiwki4g3F0p8N0HNwOJo6RoxN5nfhWaujbfNBcQbJzR5a1CJAMilzzqosOQdRytUX5EjogP3KW/HUwcWc7+T1opZLBEFJjhPBUBy/SpIT77zZMZH6lKlo2kC+rYBm8QIDAQAB
```

Derived from a 2048-bit RSA keypair generated with `openssl genrsa 2048`. Exported the public key as DER SubjectPublicKeyInfo with `openssl pkey -in <private-key-path> -pubout -outform DER`, then base64-encoded it on one line. The extension ID is the first 32 hex characters of SHA-256 of that DER public key, mapping `0123456789abcdef` to `abcdefghijklmnop`.

Origin: `chrome-extension://nldemblgfgcaolkpkajdbefjfnileeoi`

private key is stored outside the repo
