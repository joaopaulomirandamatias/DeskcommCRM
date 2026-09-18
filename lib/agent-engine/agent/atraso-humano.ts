/**
 * O TEMPO QUE UMA PESSOA LEVA PARA RESPONDER — e por que ele é feature.
 *
 * ─── O defeito ──────────────────────────────────────────────────────────────
 *
 * O agente responde no instante em que o modelo termina de gerar. Do lado do
 * cliente, no WhatsApp, isso é inconfundível: a resposta chega junto com o "✓✓"
 * da mensagem que ele acabou de mandar. Nenhum atendente humano lê, pensa e
 * digita um parágrafo em 200ms — e o cliente sabe disso. Reportado pelo dono de
 * um tenant real (sítio de eventos): "responde rápido demais, parece robô".
 *
 * O produto é um agente que ATENDE junto com humanos. Ser identificável como
 * máquina na primeira troca é perda de conversão, não detalhe estético.
 *
 * ─── A fórmula, e por que estes números ─────────────────────────────────────
 *
 *   atraso = clamp(NOTAR + POR_CARACTERE × comprimento, MINIMO, MAXIMO)
 *
 * `NOTAR` (900ms) é a parcela que NÃO depende do texto: ver a notificação,
 * abrir a conversa, ler o que o cliente escreveu. Ela existe separada do termo
 * proporcional porque mesmo um "Sim!" tem esse custo — sem ela, respostas
 * curtas voltariam a sair instantâneas, que é exatamente o defeito.
 *
 * `POR_CARACTERE` (22ms ≈ 45 caracteres/s) é digitação DELIBERADAMENTE mais
 * rápida que a real (um bom digitador faz ~8 c/s no celular). Não é erro de
 * calibração: em velocidade real, um parágrafo de 400 caracteres pediria 50
 * segundos, e um cliente esperando 50s conclui que ninguém vai responder.
 * O objetivo é "não é instantâneo", não "é indistinguível de humano" — a
 * segunda meta custa o atendimento.
 *
 * `MINIMO` (1200ms) é o piso do throttle anti-ban do canal (CLAUDE.md: 1 msg /
 * 1.2s). Um atraso "humano" menor que o piso que o anti-ban já impõe seria
 * decoração que não muda nada. `MAXIMO` (7500ms) é o teto: acima disso o
 * silêncio deixa de ler como "está digitando" e passa a ler como "caiu".
 *
 * Desde a #653, estes quatro números são os DEFAULTS, não constantes globais de
 * produto: cada conexão pode sobrescrevê-los em `channel_knobs`. Sem override,
 * o comportamento continua exatamente 900 / 22 / 1200 / 7500 ms.
 *
 * ─── Onde ele NÃO entra ─────────────────────────────────────────────────────
 *
 * Este atraso é do TURNO, antes da PRIMEIRA bolha. O intervalo ENTRE bolhas
 * continua sendo o jitter anti-ban (1.2s + ≤800ms) que já existia — são coisas
 * diferentes com donos diferentes, e somá-las numa só apagaria o throttle que
 * protege o número de banimento.
 */
import { currentExecutionPacingKnobs } from '@/lib/atendimento/fronteira-server';
import type { Logger } from '../obs/logger';
import { PACING_DEFAULTS, type HumanDelayKnobs } from '../pacing/defaults';

/** Ver o cabeçalho: a parcela que não depende do tamanho do texto. */
export const ATRASO_NOTAR_MS = PACING_DEFAULTS.humanDelay.baseMs;

/** ≈45 caracteres/s — rápido de propósito; ver o cabeçalho. */
export const MS_POR_CARACTERE = PACING_DEFAULTS.humanDelay.msPerChar;

/** Piso do throttle anti-ban do canal (CLAUDE.md). Abaixo dele o atraso não significa nada. */
export const ATRASO_MINIMO_MS = PACING_DEFAULTS.humanDelay.minMs;

/** Acima disto o silêncio lê como queda, não como digitação. */
export const ATRASO_MAXIMO_MS = PACING_DEFAULTS.humanDelay.maxMs;

/**
 * Quanto esperar antes de mandar `texto`, em ms. Pura — é o que a torna
 * testável sem relógio e sem canal. `knobs` explícito vence; durante um turno,
 * vale a configuração da conexão já lida pelo pacing; fora dele, o default.
 */
export function calcularAtrasoHumano(texto: string, knobs?: HumanDelayKnobs): number {
  const efetivos = knobs ?? currentExecutionPacingKnobs()?.humanDelay ?? PACING_DEFAULTS.humanDelay;
  const comprimento = (texto ?? '').trim().length;
  const bruto = efetivos.baseMs + efetivos.msPerChar * comprimento;
  return Math.min(efetivos.maxMs, Math.max(efetivos.minMs, bruto));
}

export interface EsperaHumanaArgs {
  /** O corpo que vai sair — é o tamanho DELE que dita a espera. */
  texto: string;
  /** Override explícito para teste/caller fora do contexto de atendimento. */
  knobs?: HumanDelayKnobs;
  sleep: (ms: number) => Promise<void>;
  log: Logger;
  /**
   * Acende o "digitando…" no aparelho do cliente. OPCIONAL: canal que não sabe
   * sinalizar presença simplesmente espera, e o ganho principal (não responder
   * instantaneamente) continua valendo.
   */
  sinalizarDigitando?: () => Promise<void>;
}

/**
 * Acende o "digitando…" e espera. Devolve os ms esperados.
 *
 * ⚠️ A PRESENÇA FALHA MACIO, E ISSO NÃO É NEGOCIÁVEL. "digitando…" é decoração;
 * a mensagem é o produto. Transporte fora do ar, sessão que não está saudável ou
 * canal que não implementa presença viram uma linha de log e o envio segue — deixar
 * uma chamada decorativa derrubar entrega seria trocar o produto pelo enfeite.
 *
 * A ordem também é o produto: sinalizar DEPOIS de esperar entregaria ao cliente
 * os segundos de silêncio sem a explicação visual que os torna naturais.
 */
export async function esperarComoHumano(args: EsperaHumanaArgs): Promise<number> {
  const ms = calcularAtrasoHumano(args.texto, args.knobs);

  if (args.sinalizarDigitando !== undefined) {
    try {
      await args.sinalizarDigitando();
    } catch (err) {
      // Sem corpo de erro e sem texto da mensagem: `lib/logger.ts` proíbe
      // conteúdo de conversa no log, e a resposta do canal pode carregá-lo.
      args.log.warn('não consegui sinalizar "digitando" (segue o envio)', {
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }

  await args.sleep(ms);
  return ms;
}
