import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM 推荐 96 bit
const TAG_BYTES = 16; // 128 bit
const VERSION = "v1";

function keyBytes(): Buffer {
  const raw = process.env.CONTENT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("CONTENT_ENCRYPTION_KEY 未配置（服务端环境变量）");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CONTENT_ENCRYPTION_KEY 必须是 32 字节的 base64");
  }
  return key;
}

function keyId(): string {
  return process.env.CONTENT_ENCRYPTION_KEY_KID ?? "k1";
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}

/**
 * AES-256-GCM。返回 `v1:<kid>:<base64(iv|tag|ciphertext)>`。
 * aad 用于把密文绑定到「租户 + 用户 + 文档 + 字段」，
 * 防止密文被搬到别的文档或别的用户下面。
 */
export function encryptField(plain: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBytes(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${keyId()}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

/** 历史明文行直接原样返回，便于平滑迁移。 */
export function decryptField(stored: string, aad: string): string {
  if (!isEncrypted(stored)) return stored;

  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("密文格式不正确");

  const payload = Buffer.from(parts[2], "base64");
  if (payload.length <= IV_BYTES + TAG_BYTES) throw new Error("密文长度不正确");

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, keyBytes(), iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}
