type Config = Record<string, any>;

const object = (value: unknown): value is Config => !!value && typeof value === "object" && !Array.isArray(value);

/** Objects are patches; arrays and scalar values replace the previous value. */
export function mergeConfig(base: Config, patch: Config): Config {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = object(value) ? mergeConfig(object(base[key]) ? base[key] : {}, value) : value;
  }
  return merged;
}

/** Only owned, changed fields are sent, so another window's settings survive. */
export function configChanges(previous: Config, current: Config): Config {
  const changed: Config = {};
  for (const [key, value] of Object.entries(current)) {
    if (value === undefined) continue;
    if (object(value)) {
      const nested = configChanges(object(previous[key]) ? previous[key] : {}, value);
      if (Object.keys(nested).length) changed[key] = nested;
    } else if (JSON.stringify(value) !== JSON.stringify(previous[key])) changed[key] = value;
  }
  return changed;
}

/** Serialize writes without a debounce gap; updates during IPC coalesce safely. */
export class ConfigWriter {
  private saved: Config | null = null;
  private wanted: Config = {};
  private pending: Promise<void> | null = null;
  private blocked: unknown = null;

  constructor(private save: (patch: Config) => Promise<unknown>, private onError: (error: unknown) => void) {}

  hydrate(config: Config) { this.saved = config; this.wanted = config; this.blocked = null; }

  block(error: unknown) { this.blocked = error; }
  get persistenceBlocked() { return this.blocked !== null; }

  acceptExternal(patch: Config) {
    if (this.saved) this.saved = mergeConfig(this.saved, patch);
    this.wanted = mergeConfig(this.wanted, patch);
  }

  update(current: Config): Promise<void> {
    this.wanted = mergeConfig(this.wanted, current);
    return this.flush();
  }

  flush(): Promise<void> {
    if (this.blocked) return Promise.reject(this.blocked);
    if (!this.saved) return Promise.resolve();
    if (this.pending) return this.pending;
    const drain = async () => {
      while (this.saved) {
        const patch = configChanges(this.saved, this.wanted);
        if (!Object.keys(patch).length) return;
        await this.save(patch);
        this.saved = mergeConfig(this.saved, patch);
      }
    };
    this.pending = drain().then(() => {
      this.pending = null;
      if (this.saved && Object.keys(configChanges(this.saved, this.wanted)).length) return this.flush();
    }, error => {
      this.pending = null;
      this.onError(error);
      throw error;
    });
    return this.pending;
  }
}
