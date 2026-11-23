/**
 * 极简 IndexedDB 封装。
 *
 * 为什么不用 localStorage：配额只有约 5 MB，一部长文档就能撞上限，而现在的
 * saveDocs 是静默失败——用户以为存了，其实没存。IndexedDB 的配额按磁盘比例给，
 * 且写入不阻塞主线程。
 *
 * 这里只提供「打开库 + 读写单条记录」这几个原语，业务语义留在 lib/docs.ts。
 */

export const DB_NAME = "marktext-web";
export const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

export function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("docs")) {
        db.createObjectStore("docs", { keyPath: "userId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    // 隐私模式 / 配额拒绝 / 被其它标签页阻塞：都退回「没有 IDB」的行为
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(store, "readonly");
    const result = await requestToPromise<T | undefined>(tx.objectStore(store).get(key));
    return result ?? null;
  } catch {
    return null;
  }
}

export async function idbPut(store: string, value: unknown): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(store, "readwrite");
    await requestToPromise(tx.objectStore(store).put(value));
    return true;
  } catch {
    return false;
  }
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(store, "readwrite");
    await requestToPromise(tx.objectStore(store).delete(key));
    return true;
  } catch {
    return false;
  }
}
