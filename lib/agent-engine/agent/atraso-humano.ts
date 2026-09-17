/**
 * O TEMPO QUE UMA PESSOA LEVA PARA RESPONDER — e por que ele é feature.
 *
 * O agente não deve responder no mesmo instante em que o modelo termina. A
 * fórmula continua determinística, mas desde a #653 os quatro números são knobs
 * por conexão em `channel_knobs`; ausência de override cai nos mesmos defaults
 * históricos, então atualizar não muda o ritmo de nenhuma instalação.
 *
 *   atraso = clamp(BASE + POR_CARACTERE × comprimento, MINIMO, MAXIMO)
 *
 * Este atraso é do TURNO, antes da PRIMEIRA bolha. O intervalo ENTRE bolhas é
 * outra decisão: usa `throttleMs + jitterMaxMs` da mesma conexão. Desde a #654 a
 * pausa humana é paga antes de tomar o lock do número; parametrizá-la não pode
 * mover essa espera de volta para dentro da transação.
 */
import type { Logger } from '../obs/logger';
import {
  PACING_DEFAULTS,
  type HumanDelayKnobs,
} from '../pacing/defaults';

/** Aliases compatíveis para consumidores/testes antigos; a fonte única é PACING_DEFAULTS. */
export const ATRASO_NOTAR_MS = PACING_DEFAULTS.humanDelay.baseMs;
export const MS_POR_CARACTERE = PACING_DEFAULTS.humanDelay.msPerChar;
export const ATRASO_MINIMO_MS = PACING_DEFAULTS.humanDelay.minMs;
export const ATRASO_MAXIMO_MS = PACING_DEFAULTS.humanDelay.maxMs;

/**
 * Quanto esperar antes de mandar `texto`, em ms. Pura — é o que a torna
 * testável sem relógio e sem canal. Sem knobs explícitos preserva o comportamento
 * histórico para callers/testes que não conhecem a configuração por conexão.
 */
export function calcularAtrasoHumano(
  texto: string,
  knobs: HumanDelayKnobs = PACING_DEFAULTS.humanDelay,
): number {
  const comprimento = (texto ?? '').trim().length;
  const bruto = knobs.baseMs + knobs.msPerChar * comprimento;
  return Math.min(knobs.maxMs, Math.max(knobs.minMs, bruto));
}

export interface EsperaHumanaArgs {
  /** O corpo que vai sair — é o tamanho DELE que dita a espera. */
  texto: string;
  /** Knobs efetivos da conexão; ausente = defaults compatíveis. */
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
