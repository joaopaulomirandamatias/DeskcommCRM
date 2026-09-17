/**
 * Defaults CONSERVADORES do motor anti-ban (F2-11) — a FONTE ÚNICA dos números
 * de pacing do daemon (blueprint 5.2: números anti-ban são fonte única e
 * inconsistente → knobs, nunca constantes). `scripts/lint-pacing.ts` reprova
 * literal de pacing em qualquer outro arquivo de daemon/src.
 *
 * Override por número/sessão: linha em `channel_knobs` (0010) — coluna NULL cai
 * aqui. O CAP DIÁRIO ABSOLUTO não mora aqui nem em channel_knobs: a fonte única
 * é `channel_sessions.daily_message_limit` (regra dura nº 3) — mesmo banco agora,
 * a cadeia de envio lê por query direta e injeta em `decidePacing` (`crmDailyLimit`).
 */

/** Degrau de warm-up: a partir de `minAgeDays` de idade do número vale `cap` envios/dia; `cap: null` = formado (sem cap de warm-up — resta só o limite do CRM). */
export interface WarmupStep {
  minAgeDays: number;
  cap: number | null;
}

/**
 * Pausa antes da PRIMEIRA bolha do turno, para a resposta não chegar no mesmo
 * instante em que o modelo termina. Também é por conexão: uma clínica e um
 * e-commerce podem querer ritmos diferentes no mesmo produto.
 */
export interface HumanDelayKnobs {
  /** Parcela fixa de reação antes de considerar o tamanho do texto. */
  baseMs: number;
  /** Parcela adicional por caractere da primeira bolha. */
  msPerChar: number;
  /** Piso do atraso resultante. */
  minMs: number;
  /** Teto do atraso resultante. */
  maxMs: number;
}

export interface PacingKnobs {
  /** Intervalo mínimo entre envios do MESMO número (ms). */
  throttleMs: number;
  /** Teto do jitter randômico somado ao throttle e ao next_allowed_at (ms) — intervalo fixo é assinatura de bot. */
  jitterMaxMs: number;
  /** Pausa humana da primeira bolha. */
  humanDelay: HumanDelayKnobs;
  /** Janela horária de envio [start, end) na hora local do tenant. */
  windowStartHour: number;
  windowEndHour: number;
  /**
   * Enviar aos domingos. **Ligado por default** — a janela horária cala à noite,
   * e o domingo inteiro mudo era cortesia demais: num CRM de atendimento, quem
   * escreve no domingo espera resposta no domingo.
   *
   * Continua sendo knob por canal (`AntiBanSheet` → `POST /api/v1/ai/pacing`):
   * quem faz prospecção ativa e prefere não incomodar no fim de semana desliga.
   */
  allowSunday: boolean;
  /** IANA timezone do tenant — a janela é avaliada NELA. */
  timezone: string;
  /** Degraus de warm-up ordenados por minAgeDays crescente (o primeiro cobre idade 0). */
  warmupDailyCaps: WarmupStep[];
}

/**
 * Limites de SANIDADE da edição de knobs no Console (FU-14) — validação de entrada do
 * operador, não defaults de comportamento. Moram aqui porque a doutrina proíbe número de
 * pacing fora deste módulo (scripts/lint-pacing.ts); o Console os importa em vez de
 * cravar literais.
 */
export const KNOB_BOUNDS = {
  /** teto de intervalo/jitter aceito na UI (ms). */
  intervalMaxMs: 600_000,
  /** Limites da pausa humana. Zero é válido: permite desligar uma parcela. */
  humanDelayBaseMaxMs: 60_000,
  humanDelayMsPerCharMax: 1_000,
  humanDelayMinMaxMs: 60_000,
  humanDelayMaxMaxMs: 120_000,
  /** maior hora aceita como INÍCIO de janela (fim vai até 24). */
  hourLastStart: 23,
  /** fim de janela é exclusivo e pode chegar à meia-noite seguinte. */
  hourEnd: 24,
} as const;

export const PACING_DEFAULTS: PacingKnobs = {
  throttleMs: 1200, // 1 msg / 1,2s
  jitterMaxMs: 800,
  // Mesmos quatro números do comportamento anterior à #653. Coluna NULL em
  // channel_knobs mantém a instalação bit a bit compatível.
  humanDelay: {
    baseMs: 900,
    msPerChar: 22,
    minMs: 1200,
    maxMs: 7500,
  },
  windowStartHour: 7, // janela 7h-22h
  windowEndHour: 22,
  allowSunday: true,
  timezone: 'America/Sao_Paulo',
  // Número sem linha em channel_knobs é tratado como idade 0 (o degrau mais
  // conservador) até alguém registrar number_activated_at.
  warmupDailyCaps: [
    { minAgeDays: 0, cap: 20 },
    { minAgeDays: 4, cap: 50 },
    { minAgeDays: 8, cap: 100 },
    { minAgeDays: 15, cap: 200 },
    { minAgeDays: 31, cap: null },
  ],
};
