'use strict';
/* ── Chain Reaction AI Web Worker ──
   Receives: { grid, orbCount, eliminated, hasMoved, aiIdx, isHard, rows, cols }
   Posts back: { move: [r, c] }
*/

let ROWS = 0, COLS = 0;
let S_grid = null; /* live board snapshot — used by simHeuristic to match original behaviour */

function simCrit(r, c) {
    const er = r === 0 || r === ROWS - 1, ec = c === 0 || c === COLS - 1;
    return er && ec ? 2 : er || ec ? 3 : 4;
}

function simNeighbors(r, c) {
    const n = [];
    if (r > 0)        n.push([r - 1, c]);
    if (r < ROWS - 1) n.push([r + 1, c]);
    if (c > 0)        n.push([r, c - 1]);
    if (c < COLS - 1) n.push([r, c + 1]);
    return n;
}

function simClone(grid, orbCount, eliminated, hasMoved) {
    return {
        grid: grid.map(row => row.map(cell => ({ owner: cell.owner, count: cell.count }))),
        orbCount: orbCount.slice(),
        eliminated: eliminated.slice(),
        hasMoved: hasMoved.slice()
    };
}

/* Optimized: track only candidate cells instead of full grid scan */
function simApplyMove(grid, orbCount, eliminated, hasMoved, player, r, c) {
    const s = simClone(grid, orbCount, eliminated, hasMoved);
    const np = orbCount.length;
    s.grid[r][c].owner = player;
    s.grid[r][c].count++;
    s.orbCount[player]++;
    s.hasMoved[player] = true;

    /* Seed candidates with the placed cell */
    let candidates = new Set();
    if (s.grid[r][c].count >= simCrit(r, c)) candidates.add(r * COLS + c);

    let iters = 0;
    while (candidates.size && iters++ < 800) {
        /* Collect truly unstable cells from candidates */
        const unstable = [];
        for (const idx of candidates) {
            const rr = (idx / COLS) | 0, cc = idx % COLS;
            if (s.grid[rr][cc].count >= simCrit(rr, cc)) unstable.push([rr, cc]);
        }
        candidates = new Set();
        if (!unstable.length) break;

        for (const [rr, cc] of unstable) {
            const owner = s.grid[rr][cc].owner;
            const cm    = simCrit(rr, cc);
            s.grid[rr][cc].count -= cm;
            s.orbCount[owner]    -= cm;
            if (s.grid[rr][cc].count <= 0) {
                s.grid[rr][cc].count = 0;
                s.grid[rr][cc].owner = -1;
            }
            for (const [nr, nc] of simNeighbors(rr, cc)) {
                const ncell = s.grid[nr][nc];
                if (ncell.owner !== -1 && ncell.owner !== owner) {
                    s.orbCount[ncell.owner] -= ncell.count;
                    s.orbCount[owner]       += ncell.count;
                    ncell.owner = owner;
                } else if (ncell.owner === -1) {
                    ncell.owner = owner;
                }
                ncell.count++;
                s.orbCount[owner]++;
                if (ncell.count >= simCrit(nr, nc)) candidates.add(nr * COLS + nc);
            }
            /* Exploded cell may still be unstable */
            if (s.grid[rr][cc].count >= simCrit(rr, cc)) candidates.add(rr * COLS + cc);
        }

        if (s.hasMoved.every(Boolean))
            for (let i = 0; i < np; i++)
                if (!s.eliminated[i] && s.orbCount[i] <= 0) s.eliminated[i] = true;
    }
    return s;
}

/* Matches original behaviour: positional scoring uses S_grid (live board snapshot) */
function simHeuristic(grid, orbCount, eliminated, aiIdx) {
    if (eliminated[aiIdx]) return -Infinity;
    const survivors = eliminated.filter(e => !e).length;
    if (survivors <= 1) return Infinity;
    let score = orbCount[aiIdx] * 3;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = S_grid[r][c];
            if (cell.owner === aiIdx) {
                const cm = simCrit(r, c);
                if (cell.count === cm - 1)      score += 8;
                else if (cell.count === cm - 2) score += 3;
                for (const [nr, nc] of simNeighbors(r, c)) {
                    const n = S_grid[nr][nc];
                    if (n.owner !== -1 && n.owner !== aiIdx && n.count >= simCrit(nr, nc) - 1)
                        score -= 6;
                }
            }
        }
    }
    const otherOrbs = orbCount.reduce((acc, v, i) =>
        (!eliminated[i] && i !== aiIdx) ? acc + v : acc, 0);
    score -= otherOrbs;
    score += 40;
    return score;
}

function simCandidates(grid, orbCount, player, maxMoves) {
    const scored = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = grid[r][c];
            if (cell.owner !== -1 && cell.owner !== player) continue;
            let score = 0;
            const cm = simCrit(r, c);
            if (cell.owner === player)          score += 8;
            if (cell.count === cm - 1)          score += 30;
            else if (cell.count === cm - 2)     score += 12;
            else                                score += cell.count * 2;
            for (const [nr, nc] of simNeighbors(r, c)) {
                const ncell = grid[nr][nc];
                if (ncell.owner !== -1 && ncell.owner !== player) {
                    score += 3;
                    if (ncell.count >= simCrit(nr, nc) - 1) { score += 5; score -= 4; }
                }
            }
            scored.push({ r, c, score });
        }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxMoves).map(m => [m.r, m.c]);
}

function simNextPlayer(current, eliminated) {
    const n = eliminated.length;
    let next = (current + 1) % n, guard = 0;
    while (eliminated[next] && guard++ < n) next = (next + 1) % n;
    return next;
}

/* Compact key: owner+1 fits in 0-8, count fits in 0-31, pack into base36 */
function makeKey(turnPlayer, depth, grid) {
    let k = turnPlayer + '|' + depth + '|';
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
            const cell = grid[r][c];
            k += ((cell.owner + 1) * 32 + cell.count).toString(36);
        }
    return k;
}

function minimax(grid, orbCount, eliminated, hasMoved, aiIdx, turnPlayer, depth, alpha, beta, memo, numPlayers) {
    const key = makeKey(turnPlayer, depth, grid);
    if (memo.has(key)) return memo.get(key);

    const survivors = eliminated.map((e, i) => !e ? i : -1).filter(i => i >= 0);
    if (survivors.length <= 1) {
        const val = (survivors.length === 1 && survivors[0] === aiIdx) ? Infinity : -Infinity;
        memo.set(key, val); return val;
    }
    if (depth === 0) {
        const val = simHeuristic(grid, orbCount, eliminated, aiIdx);
        memo.set(key, val); return val;
    }

    const MAX_BRANCH = 12;
    const moves = simCandidates(grid, orbCount, turnPlayer, MAX_BRANCH);
    if (!moves.length) {
        const val = simHeuristic(grid, orbCount, eliminated, aiIdx);
        memo.set(key, val); return val;
    }

    if (turnPlayer === aiIdx) {
        // Maximising: AI picks move that leads to highest value
        let best = -Infinity;
        for (const [r, c] of moves) {
            const s    = simApplyMove(grid, orbCount, eliminated, hasMoved, turnPlayer, r, c);
            const next = simNextPlayer(turnPlayer, s.eliminated);
            const val  = minimax(s.grid, s.orbCount, s.eliminated, s.hasMoved, aiIdx, next, depth - 1, alpha, beta, memo, numPlayers);
            if (val > best)  best  = val;
            if (best > alpha) alpha = best;
            if (beta <= alpha) break;
        }
        memo.set(key, best); return best;
    } else if (numPlayers === 2) {
        // 2-player: true adversarial — opponent minimises AI's score
        let worst = Infinity;
        for (const [r, c] of moves) {
            const s    = simApplyMove(grid, orbCount, eliminated, hasMoved, turnPlayer, r, c);
            const next = simNextPlayer(turnPlayer, s.eliminated);
            const val  = minimax(s.grid, s.orbCount, s.eliminated, s.hasMoved, aiIdx, next, depth - 1, alpha, beta, memo, numPlayers);
            if (val < worst) worst = val;
            if (worst < beta) beta = worst;
            if (beta <= alpha) break;
        }
        memo.set(key, worst); return worst;
    } else {
        // 3+ players: each opponent plays greedily for themselves — paranoid assumption
        // breaks down in multiplayer since opponents aren't actually coordinating against us
        let bestOppVal = -Infinity, bestR = moves[0][0], bestC = moves[0][1];
        for (const [r, c] of moves) {
            const s   = simApplyMove(grid, orbCount, eliminated, hasMoved, turnPlayer, r, c);
            const opp = simHeuristic(s.grid, s.orbCount, s.eliminated, turnPlayer);
            if (opp > bestOppVal) { bestOppVal = opp; bestR = r; bestC = c; }
        }
        const s    = simApplyMove(grid, orbCount, eliminated, hasMoved, turnPlayer, bestR, bestC);
        const next = simNextPlayer(turnPlayer, s.eliminated);
        const val  = minimax(s.grid, s.orbCount, s.eliminated, s.hasMoved, aiIdx, next, depth - 1, alpha, beta, memo, numPlayers);
        memo.set(key, val); return val;
    }
}

function aiPickMove(aiIdx, grid, orbCount, eliminated, hasMoved, isHard, numPlayers) {
    const depth = isHard
        ? (ROWS * COLS <= 49 ? 4 : 3)
        : (ROWS * COLS <= 49 ? 2 : 1);
    const MAX_BRANCH = isHard ? 8 : 12;
    const memo  = new Map();
    const moves = simCandidates(grid, orbCount, aiIdx, MAX_BRANCH);
    if (!moves.length) return null;
    let bestScore = -Infinity, bestMove = moves[0];
    for (const [r, c] of moves) {
        const s    = simApplyMove(grid, orbCount, eliminated, hasMoved, aiIdx, r, c);
        const next = simNextPlayer(aiIdx, s.eliminated);
        const score = depth >= 2
            ? minimax(s.grid, s.orbCount, s.eliminated, s.hasMoved, aiIdx, next, depth - 1, -Infinity, Infinity, memo, numPlayers)
            : simHeuristic(s.grid, s.orbCount, s.eliminated, aiIdx);
        if (score > bestScore) { bestScore = score; bestMove = [r, c]; }
    }
    return bestMove;
}

self.onmessage = function (e) {
    const { grid, orbCount, eliminated, hasMoved, aiIdx, isHard, rows, cols, numPlayers } = e.data;
    ROWS = rows;
    COLS = cols;
    S_grid = grid; /* snapshot of live board for heuristic — matches original S.grid behaviour */
    const move = aiPickMove(aiIdx, grid, orbCount, eliminated, hasMoved, isHard, numPlayers);
    self.postMessage({ move });
};
