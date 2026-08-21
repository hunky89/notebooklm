import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const queues = new Map<string, Promise<void>>();

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson<T>(path: string, value: T) {
  const queue = queues.get(path) || Promise.resolve();
  const next = queue.then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporaryPath, path);
  });
  queues.set(path, next.catch(() => undefined));
  await next;
}

export async function mutateJson<T>(path: string, fallback: T, update: (value: T) => T | Promise<T>) {
  const queue = queues.get(path) || Promise.resolve();
  let result = fallback;
  const next = queue.then(async () => {
    result = await update(await readJson(path, fallback));
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(result, null, 2), { mode: 0o600 });
    await rename(temporaryPath, path);
  });
  queues.set(path, next.catch(() => undefined));
  await next;
  return result;
}
