import { describe, expect, it } from "vitest";

import { KNOB_BOUNDS, PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import {
  effectiveKnobs,
  humanDelayIsValid,
  pacingKnobsUpdateSchema,
  windowIsValid,
  knobsView,
  type ChannelKnobsRow,
} from "./pacing-knobs";

const SESSION = "aaaaaaaa-0000-4000-8000-000000000001";
const ROW_VAZIA: ChannelKnobsRow = {
  throttle_ms: null,
  jitter_max_ms: null,
  human_delay_base_ms: null,
  human_delay_ms_per_char: null,
  human_delay_min_ms: null,
  human_delay_max_ms: null,
  window_start_hour: null,
  window_end_hour: null,
  allow_sunday: null,
  timezone: null,
  warmup_daily_caps: null,
};

describe("pacing-knobs — validação com KNOB_BOUNDS (números nunca nascem aqui)", () => {
  it("aceita update válido e rejeita acima dos bounds do engine", () => {
    expect(
      pacingKnobsUpdateSchema.safeParse({
        channel_session_id: SESSION,
        throttle_ms: KNOB_BOUNDS.intervalMaxMs,
        human_delay_base_ms: KNOB_BOUNDS.humanDelayBaseMaxMs,
        human_delay_ms_per_char: KNOB_BOUNDS.humanDelayMsPerCharMax,
        human_delay_min_ms: KNOB_BOUNDS.humanDelayMinMaxMs,
        human_delay_max_ms: KNOB_BOUNDS.humanDelayMaxMaxMs,
        window_start_hour: KNOB_BOUNDS.hourLastStart,
        window_end_hour: KNOB_BOUNDS.hourEnd,
      }).success,
    ).toBe(true);
    expect(
      pacingKnobsUpdateSchema.safeParse({
        channel_session_id: SESSION,
        throttle_ms: KNOB_BOUNDS.intervalMaxMs + 1,
      }).success,
    ).toBe(false);
    expect(
      pacingKnobsUpdateSchema.safeParse({
        channel_session_id: SESSION,
        human_delay_ms_per_char: KNOB_BOUNDS.humanDelayMsPerCharMax + 1,
      }).success,
    ).toBe(false);
  });

  it("timezone IANA validada; campo desconhecido rejeitado (strict)", () => {
    expect(
      pacingKnobsUpdateSchema.safeParse({
        channel_session_id: SESSION,
        timezone: "America/Sao_Paulo",
      }).success,
    ).toBe(true);
    expect(
      pacingKnobsUpdateSchema.safeParse({
        channel_session_id: SESSION,
        timezone: "Marte/Cratera",
      }).success,
    ).toBe(false);
    expect(
      pacingKnobsUpdateSchema.safeParse({
        channel_session_id: SESSION,
        warmup_daily_caps: [],
      }).success,
    ).toBe(false);
  });

  it("teto diário: 0 rejeitado (desligar tem forma expressa), null não aceito", () => {
    expect(
      pacingKnobsUpdateSchema.safeParse({
        channel_session_id: SESSION,
        daily_message_limit: 0,
      }).success,
    ).toBe(false);
    expect(
      pacingKnobsUpdateSchema.safeParse({
        channel_session_id: SESSION,
        daily_message_limit: 300,
      }).success,
    ).toBe(true);
  });

  it("effectiveKnobs: NULL cai no default conservador; override vence", () => {
    expect(effectiveKnobs(null)).toEqual(PACING_DEFAULTS);
    const eff = effectiveKnobs({
      ...ROW_VAZIA,
      throttle_ms: 5000,
      human_delay_base_ms: 1500,
      human_delay_ms_per_char: 30,
      human_delay_min_ms: 2000,
      human_delay_max_ms: 9000,
      window_start_hour: 9,
    });
    expect(eff.throttleMs).toBe(5000);
    expect(eff.jitterMaxMs).toBe(PACING_DEFAULTS.jitterMaxMs);
    expect(eff.humanDelay).toEqual({ baseMs: 1500, msPerChar: 30, minMs: 2000, maxMs: 9000 });
    expect(eff.windowStartHour).toBe(9);
    expect(eff.windowEndHour).toBe(PACING_DEFAULTS.windowEndHour);
  });

  it("warmup jsonb inválido cai nos defaults (mesma leitura fail-closed do engine)", () => {
    const eff = effectiveKnobs({
      ...ROW_VAZIA,
      warmup_daily_caps: [{ errado: true }],
    });
    expect(eff.warmupDailyCaps).toEqual(PACING_DEFAULTS.warmupDailyCaps);
  });

  it("janela resultante: start < end obrigatório", () => {
    expect(windowIsValid(7, 22)).toBe(true);
    expect(windowIsValid(22, 7)).toBe(false);
    expect(windowIsValid(8, 8)).toBe(false);
  });

  it("clamp do atraso humano exige piso <= teto", () => {
    expect(humanDelayIsValid(1200, 7500)).toBe(true);
    expect(humanDelayIsValid(7501, 7500)).toBe(false);
  });

  it("knobsView expõe defaults e bounds pra tela não cravar números", () => {
    const view = knobsView(null);
    expect(view.defaults).toEqual(PACING_DEFAULTS);
    expect(view.bounds.intervalMaxMs).toBe(KNOB_BOUNDS.intervalMaxMs);
    expect(view.bounds.humanDelayMaxMaxMs).toBe(KNOB_BOUNDS.humanDelayMaxMaxMs);
    expect(view.bounds.daily_limit.min).toBe(1);
    expect(view.overrides).toBeNull();
  });
});
