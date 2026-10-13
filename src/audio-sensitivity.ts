type SensitivityCommand = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/** Always persist the final slider value before rebuilding its running recognizer. */
export async function commitAudioSensitivity(command: SensitivityCommand, lang: string, value: number): Promise<void> {
  await command("audio_set_sensitivity", { lang, value });
  await command("audio_apply_sensitivity", { lang });
}

/** Preserve order between throttled live writes and a gesture's final commit. */
export class AudioSensitivityWriter {
  private tail: Promise<void> = Promise.resolve();
  private wanted = new Map<string, { value: number; apply: boolean; id: number }>();
  private nextId = 0;
  constructor(private command: SensitivityCommand) {}

  update(lang: string, value: number, apply: boolean): Promise<void> {
    const request = { value, apply, id: ++this.nextId };
    this.wanted.set(lang, request);
    const next = this.tail.catch(() => {}).then(async () => {
      if (apply) await commitAudioSensitivity(this.command, lang, value);
      else await this.command("audio_set_sensitivity", { lang, value });
      if (this.wanted.get(lang)?.id === request.id) this.wanted.delete(lang);
    });
    this.tail = next;
    return next;
  }

  async flush(): Promise<void> {
    for (;;) {
      const observed = this.tail;
      await observed.catch(() => {});
      if (observed !== this.tail) continue;
      const dirty = [...this.wanted.entries()];
      if (!dirty.length) return;
      // One failed language cannot disappear merely because another write succeeded.
      for (const [lang, value] of dirty) {
        const current = this.wanted.get(lang);
        if (current?.id === value.id) await this.update(lang, current.value, current.apply);
      }
    }
  }
}
