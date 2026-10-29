// Stands in for the board's NVS flash: per-device broker logins survive restarts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Creds } from '@sw6/protocol';

export class CredsStore {
  private data: Record<string, Creds>;

  constructor(private readonly path: string) {
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  }

  get(deviceId: string): Creds | undefined {
    return this.data[deviceId];
  }

  set(deviceId: string, creds: Creds) {
    this.data[deviceId] = creds;
    this.save();
  }

  delete(deviceId: string) {
    delete this.data[deviceId];
    this.save();
  }

  private save() {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}
