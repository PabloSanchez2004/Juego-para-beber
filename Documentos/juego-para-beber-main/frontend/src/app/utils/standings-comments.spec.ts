import { PlayerPublicDto } from '../models/game.models';
import { buildFinalStandings, namesOf } from './standings-comments';

function player(id: string, name: string, score: number): PlayerPublicDto {
  return {
    playerId: id, name, role: 'Estimator', score, drinksOwed: 0,
    isConnected: true, alcoholFree: false, guess: null,
  };
}

describe('buildFinalStandings', () => {
  it('ranks by score and marks best / worst', () => {
    const rows = buildFinalStandings([
      player('p1', 'Ana', 80),
      player('p2', 'Bob', 200),
      player('p3', 'Carlos', 10),
    ], 'ROOM');

    expect(rows.map(r => r.player.name)).toEqual(['Bob', 'Ana', 'Carlos']);
    expect(rows[0].outcome).toBe('best');
    expect(rows[0].place).toBe(1);
    expect(rows[1].outcome).toBe('mid');
    expect(rows[2].outcome).toBe('worst');
    expect(rows[0].comment.length).toBeGreaterThan(10);
    expect(rows[2].comment.length).toBeGreaterThan(10);
    expect(namesOf(rows, 'best')).toBe('Bob');
    expect(namesOf(rows, 'worst')).toBe('Carlos');
  });

  it('treats a full tie as nobody best or worst', () => {
    const rows = buildFinalStandings([
      player('p1', 'Ana', 50),
      player('p2', 'Bob', 50),
    ]);
    expect(rows.every(r => r.outcome === 'mid')).toBeTrue();
  });

  it('keeps comments stable for the same seed', () => {
    const a = buildFinalStandings([player('p1', 'Ana', 90), player('p2', 'Bob', 10)], 'X');
    const b = buildFinalStandings([player('p1', 'Ana', 90), player('p2', 'Bob', 10)], 'X');
    expect(a[0].comment).toBe(b[0].comment);
    expect(a[1].comment).toBe(b[1].comment);
  });
});
