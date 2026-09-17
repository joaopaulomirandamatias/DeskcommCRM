/**
 * Épico Operação Visível (F2ii) — leitura/escrita dos knobs de pacing que o
 * engine JÁ respeita (channel_knobs, coluna NULL = default conservador) + o teto
 * diário absoluto (channel_sessions.daily_message_limit, fonte única — regra
 * dura nº 3). Validação de entrada do operador usa KNOB_BOUNDS de
 * lib/agent-engine/pacing/defaults.ts — números de pacing nunca nascem aqui.
 */
import { z } from "zod";

import {
  KNOB_BOUNDS,
  PACING_DEFAULTS,
  type PacingKnobs,
} from "@/lib/agent-engine/pacing/defaults";
import { warmupCapFor } from "@/lib/agent-engine/pacing/engine";
import { parseWarmupCaps } from "@/lib/agent-engine/pacing/store";

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanidade de UI para o teto diário (coluna do CRM, não knob do engine — o
 * engine só LÊ channel_sessions.daily_message_limit). 0 é rejeitado: "desligar
 * envios" tem forma expressa (pausar o agente), nunca um teto silencioso de 0.
 */
export const DAILY_LIMIT_BOUNDS = { min: 1, max: 10_000 } as const;

/**
 * O fuso mais adiantado que existe é UTC+14 (Kiritimati). Logo, o maior DIA de
 * calendário em vigor em algum lugar do planeta é o dia UTC de `agora + 14h`.
 */
const MAIOR_ADIANTAMENTO_MS = 14 * 3_600_000;

/** O dia do calendário (`yyyy-mm-dd`) de um instante, lido em UTC. */
function diaEmUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Hoje no calendário de quem está olhando a tela (`yyyy-mm-dd`) — o mesmo espaço
 * de valores de um `<input type="date">`, que fala em dia LOCAL.
 */
export function diaDeHojeLocal(agora: Date = new Date()): string {
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** O DIA declarado em `number_activated_at` já começou em algum lugar do mundo? */
export function diaDeclaradoJaComecou(iso: string, agora: Date = new Date()): boolean {
  const instante = Date.parse(iso);
  if (!Number.isFinite(instante)) return false;
  return diaEmUtc(instante) <= diaEmUtc(agora.getTime() + MAIOR_ADIANTAMENTO_MS);
}

const inteiroNaoNegativo = (max: number) => z.number().int().min(0).max(max).nullable().optional();

/** Campos editáveis pela tela — null = voltar ao default conservador do engine. */
export const pacingKnobsUpdateSchema = z
  .object({
    channel_session_id: z.string().uuid(),
    throttle_ms: inteiroNaoNegativo(KNOB_BOUNDS.intervalMaxMs),
    jitter_max_ms: inteiroNaoNegativo(KNOB_BOUNDS.intervalMaxMs),
    human_delay_base_ms: inteiroNaoNegativo(KNOB_BOUNDS.humanDelayBaseMaxMs),
    human_delay_ms_per_char: inteiroNaoNegativo(KNOB_BOUNDS.humanDelayMsPerCharMax),
    human_delay_min_ms: inteiroNaoNegativo(KNOB_BOUNDS.humanDelayMinMaxMs),
    human_delay_max_ms: inteiroNaoNegativo(KNOB_BOUNDS.humanDelayMaxMaxMs),
    window_start_hour: z.number().int().min(0).max(KNOB_BOUNDS.hourLastStart).nullable().optional(),
    window_end_hour: z.number().int().min(1).max(KNOB_BOUNDS.hourEnd).nullable().optional(),
    allow_sunday: z.boolean().nullable().optional(),
    timezone: z
      .string()
      .refine(isValidTimezone, "timezone IANA inválida (ex.: America/Sao_Paulo)")
      .nullable()
      .optional(),
    daily_message_limit: z
      .number()
      .int()
      .min(DAILY_LIMIT_BOUNDS.min)
      .max(DAILY_LIMIT_BOUNDS.max)
      .optional(),
    number_activated_at: z
      .string()
      .datetime({ offset: true })
      .refine(
        (iso) => diaDeclaradoJaComecou(iso),
        "a data é de um dia que ainda não começou em lugar nenhum do mundo",
      )
      .nullable()
      .optional(),
    skip_warmup: z.boolean().optional(),
  })
  .strict();

export type PacingKnobsUpdate = z.infer<typeof pacingKnobsUpdateSchema>;

export interface ChannelKnobsRow {
  throttle_ms: number | null;
  jitter_max_ms: number | null;
  human_delay_base_ms: number | null;
  human_delay_ms_per_char: number | null;
  human_delay_min_ms: number | null;
  human_delay_max_ms: number | null;
  window_start_hour: number | null;
  window_end_hour: number | null;
  allow_sunday: boolean | null;
  timezone: string | null;
  warmup_daily_caps: unknown;
  /** idade do número p/ warm-up (linha ausente = engine trata como idade 0). */
  number_activated_at?: string | null;
}

/** Janela efetiva coerente: [start, end) com start < end. */
export function windowIsValid(startHour: number, endHour: number): boolean {
  return startHour < endHour;
}

/** Piso/teto efetivos da pausa humana precisam formar um clamp válido. */
export function humanDelayIsValid(minMs: number, maxMs: number): boolean {
  return minMs <= maxMs;
}

/** Knobs efetivos para exibição: linha (se houver) sobre os defaults do engine. */
export function effectiveKnobs(row: ChannelKnobsRow | null): PacingKnobs {
  return {
    throttleMs: row?.throttle_ms ?? PACING_DEFAULTS.throttleMs,
    jitterMaxMs: row?.jitter_max_ms ?? PACING_DEFAULTS.jitterMaxMs,
    humanDelay: {
      baseMs: row?.human_delay_base_ms ?? PACING_DEFAULTS.humanDelay.baseMs,
      msPerChar: row?.human_delay_ms_per_char ?? PACING_DEFAULTS.humanDelay.msPerChar,
      minMs: row?.human_delay_min_ms ?? PACING_DEFAULTS.humanDelay.minMs,
      maxMs: row?.human_delay_max_ms ?? PACING_DEFAULTS.humanDelay.maxMs,
    },
    windowStartHour: row?.window_start_hour ?? PACING_DEFAULTS.windowStartHour,
    windowEndHour: row?.window_end_hour ?? PACING_DEFAULTS.windowEndHour,
    allowSunday: row?.allow_sunday ?? PACING_DEFAULTS.allowSunday,
    timezone: row?.timezone ?? PACING_DEFAULTS.timezone,
    warmupDailyCaps: parseWarmupCaps(row?.warmup_daily_caps) ?? PACING_DEFAULTS.warmupDailyCaps,
  };
}

/** Forma gravada em `warmup_daily_caps` quando o dono declara o número já aquecido. */
export const WARMUP_PULADO = [{ minAgeDays: 0, cap: null }] as const;

/** A configuração de warm-up desta conexão é a de "já aquecido"? */
export function warmupEstaPulado(row: ChannelKnobsRow | null): boolean {
  const caps = parseWarmupCaps(row?.warmup_daily_caps);
  return caps?.length === 1 && caps[0]?.minAgeDays === 0 && caps[0]?.cap === null;
}

/** Dias completos desde a ativação do número. Sem data = 0 (o motor é conservador). */
export function idadeEmDias(row: ChannelKnobsRow | null, agora: Date = new Date()): number {
  const iso = row?.number_activated_at;
  if (!iso) return 0;
  const ms = agora.getTime() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

/** Payload de GET para a tela: efetivo + override + defaults + limites. */
export function knobsView(row: ChannelKnobsRow | null, agora: Date = new Date()) {
  const efetivo = effectiveKnobs(row);
  const dias = idadeEmDias(row, agora);
  return {
    effective: efetivo,
    overrides: row,
    defaults: PACING_DEFAULTS,
    bounds: { ...KNOB_BOUNDS, daily_limit: DAILY_LIMIT_BOUNDS },
    warmup: {
      number_activated_at: row?.number_activated_at ?? null,
      age_days: dias,
      skipped: warmupEstaPulado(row),
      /** Teto de HOJE pelo aquecimento. null = sem teto (formado ou pulado). */
      cap_today: warmupCapFor(dias, efetivo.warmupDailyCaps),
    },
  };
}

/**
 * O valor a GRAVAR para um knob booleano da ficha Anti-ban: `null` quando o
 * operador está no default (herda), o booleano quando ele diverge (override).
 */
export function valorDeOverride(valorNaTela: boolean, padrao: boolean): boolean | null {
  return valorNaTela === padrao ? null : valorNaTela;
}
