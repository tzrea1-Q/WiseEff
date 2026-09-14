import { createEphemeralTestDatabase } from "../server/testing/testDatabase";
import { readCanonicalSchemaFingerprint } from "../server/testing/parameterCatalog/database";
(async () => {
  const eph = await createEphemeralTestDatabase("fp0144");
  const fp = await readCanonicalSchemaFingerprint(eph.url);
  console.log("FINGERPRINT", fp);
  await eph.drop();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
