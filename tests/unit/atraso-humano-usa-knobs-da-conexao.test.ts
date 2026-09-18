import { describe, expect, it, vi } from "vitest";

import {
  currentExecutionPacingKnobs,
  setExecutionPacingKnobs,
  withServiceBoundary,
} from "@/lib/atendimento/fronteira-server";
import { calcularAtrasoHumano } from "@/lib/agent-engine/agent/atraso-humano";
import { sendInBubbles } from "@/lib/agent-engine/agent/split-message";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { loadChannelKnobs } from "@/lib/agent-engine/pacing/store";

const dbSemBoundary = {
  async query() {
    return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
  },
};

describe("knobs temporais por conexão no runtime", () => {
  it("loadChannelKnobs publica a mesma configuração no contexto isolado do turno", async () => {
    const db = {
      async query(sql: string) {
        if (!sql.includes("from channel_knobs")) throw new Error("query inesperada");
        return {
          rows: [
            {
              throttle_ms: 2_500,
              jitter_max_ms: 0,
              human_delay_base_ms: 3_000,
              human_delay_ms_per_char: 0,
              human_delay_min_ms: 3_000,
              human_delay_max_ms: 3_000,
              window_start_hour: null,
              window_end_hour: null,
              allow_sunday: null,
              timezone: null,
              warmup_daily_caps: null,
              number_activated_at: new Date("2026-01-01T00:00:00.000Z"),
            },
          ],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      },
    };

    expect(currentExecutionPacingKnobs()).toBeNull();
    await withServiceBoundary(dbSemBoundary, null, async () => {
      const cfg = await loadChannelKnobs(db, "org-1", "canal-1");
      expect(currentExecutionPacingKnobs()).toEqual(cfg.knobs);
      expect(calcularAtrasoHumano("Oi")).toBe(3_000);
    });
    expect(currentExecutionPacingKnobs()).toBeNull();
  });

  it("bolhas usam throttle da conexão e não o fallback literal do chamador", async () => {
    const sleep = vi.fn(async () => undefined);
    const fallback = vi.fn(() => 99_999);
    const send = vi.fn(async () => ({ kind: "sent" as const, messageId: "m" }));

    await withServiceBoundary(dbSemBoundary, null, async () => {
      setExecutionPacingKnobs({
        ...PACING_DEFAULTS,
        humanDelay: { ...PACING_DEFAULTS.humanDelay },
        throttleMs: 2_500,
        jitterMaxMs: 0,
      });
      await sendInBubbles("um dois", {
        enabled: true,
        maxChars: 5,
        sleep,
        jitter: fallback,
        send,
      });
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2_500);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("fora do contexto preserva o jitter injetável legado", async () => {
    const sleep = vi.fn(async () => undefined);
    const fallback = vi.fn(() => 1_777);
    const send = vi.fn(async () => ({ kind: "sent" as const, messageId: "m" }));

    await sendInBubbles("um dois", {
      enabled: true,
      maxChars: 5,
      sleep,
      jitter: fallback,
      send,
    });

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_777);
  });
});
