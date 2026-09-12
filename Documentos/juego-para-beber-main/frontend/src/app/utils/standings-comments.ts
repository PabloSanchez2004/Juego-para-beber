import { PlayerPublicDto } from '../models/game.models';

export type FinalOutcome = 'best' | 'worst' | 'mid';

export interface FinalStanding {
  player: PlayerPublicDto;
  place: number;
  outcome: FinalOutcome;
  comment: string;
}

const PRAISE = [
  (n: string) => `${n} ha venido a un examen y el resto a un karaoke.`,
  (n: string) => `GPS interno de fábrica: ${n} no se pierde ni en un Ikea.`,
  (n: string) => `Si las estimaciones fueran dardos, ${n} habría partido la diana.`,
  (n: string) => `${n} ha dejado el ranking con olor a primer puesto.`,
];

const ROAST = [
  (n: string) => `${n}, tu brújula se ha ido de cañas sin ti.`,
  (n: string) => `${n} ha estimado como quien tira un dardo con los ojos vendados.`,
  (n: string) => `Wikipedia acaba de pedirle perdón a ${n}.`,
  (n: string) => `${n} estaba tan lejos que el número le ha mandado una postal.`,
];

const MID = [
  (n: string) => `${n} ha sobrevivido. Ni gloria ni pozo. Esta vez.`,
  (n: string) => `${n}: decente, anónimo y sin parte médico. Bien.`,
];

const TIE = [
  () => `Empate técnico. O bebéis todos o no bebe nadie: votadlo como en Eurovisión.`,
];

function pick<T>(items: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return items[h % items.length];
}

/** Clasificación final por puntos. El mejor y el peor solo existen si hay diferencia de score. */
export function buildFinalStandings(players: PlayerPublicDto[], roomCode = ''): FinalStanding[] {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (sorted.length === 0) return [];

  const topScore = sorted[0].score;
  const bottomScore = sorted[sorted.length - 1].score;
  const allTied = topScore === bottomScore;

  let place = 1;
  return sorted.map((player, i) => {
    if (i > 0 && player.score !== sorted[i - 1].score) place = i + 1;

    const seed = `${roomCode}:${player.playerId}:${player.score}`;
    let outcome: FinalOutcome = 'mid';
    let comment = pick(MID, seed)(player.name);

    if (allTied) {
      comment = pick(TIE, seed)();
    } else if (player.score === topScore) {
      outcome = 'best';
      comment = pick(PRAISE, seed)(player.name);
    } else if (player.score === bottomScore) {
      outcome = 'worst';
      comment = pick(ROAST, seed)(player.name);
    }

    return { player, place, outcome, comment };
  });
}

export function namesOf(rows: FinalStanding[], outcome: FinalOutcome): string {
  return rows.filter(r => r.outcome === outcome).map(r => r.player.name).join(' y ');
}
