import { getCardValue, getRankValue, isHeartTen, sortCards } from "./cards";
import type { Card, GameResult, Play, PlayType, Player, Rank } from "./types";

interface Group {
  rank: Rank;
  value: number;
  cards: Card[];
}

export function analyzePlay(cards: Card[]): Play {
  const sorted = sortCards(cards);
  if (sorted.length === 0) {
    throw new Error("请选择要出的牌。");
  }

  const jokerCount = sorted.filter((card) => card.rank === "JOKER").length;
  if (jokerCount === sorted.length && jokerCount >= 2) {
    return makePlay(sorted, "bomb", 100 + jokerCount, jokerCount * 2, `王炸 x${jokerCount}`, true);
  }

  const groups = groupByRank(sorted);
  if (groups.length === 1 && sorted[0].rank !== "JOKER" && sorted.length >= 3) {
    const value = groups[0].value;
    return makePlay(sorted, "bomb", value, sorted.length, `${sorted.length}张炸弹`);
  }

  if (sorted.length === 1) {
    return makePlay(sorted, "single", getCardValue(sorted[0]), 0, "单张");
  }

  if (
    sorted.length === 2 &&
    groups.length === 1 &&
    groups[0].cards.length === 2 &&
    sorted[0].rank !== "JOKER"
  ) {
    return makePlay(sorted, "pair", groups[0].value, 0, "对子");
  }

  const straight = analyzeStraight(sorted, groups);
  if (straight) return straight;

  const consecutivePairs = analyzeGroupedSequence(sorted, groups, 2, "consecutive_pairs");
  if (consecutivePairs) return consecutivePairs;

  const tripleSequence = analyzeGroupedSequence(sorted, groups, 3, "triple_sequence");
  if (tripleSequence) return tripleSequence;

  throw new Error("这个牌型不符合规则。");
}

export function canBeat(candidate: Play, current?: Play): boolean {
  if (!current) return true;

  if (candidate.type === "bomb") {
    if (current.type === "triple_sequence" && (candidate.bombPower ?? 0) < 5) return false;
    if (current.type !== "bomb") return true;
    return compareBomb(candidate, current) > 0;
  }

  if (current.type === "bomb") return false;
  if (candidate.type !== current.type) return false;
  if (candidate.length !== current.length) return false;

  return candidate.rankValue > current.rankValue;
}

export function selectedContainsHeartTen(cards: Card[]): boolean {
  return cards.some(isHeartTen);
}

export function calculateResult(players: Player[]): GameResult {
  const rankedPlayers = [...players].sort((left, right) => {
    return (left.finishRank ?? Number.MAX_SAFE_INTEGER) - (right.finishRank ?? Number.MAX_SAFE_INTEGER);
  });
  const redPlayers = rankedPlayers.filter((player) => player.isRedTeam);
  const normalPlayers = rankedPlayers.filter((player) => !player.isRedTeam);
  const redIds = new Set(redPlayers.map((player) => player.id));

  if (redPlayers.length === 0 || normalPlayers.length === 0) {
    return {
      outcome: "draw",
      winner: "none",
      message: "本局阵营不完整，平局。",
      capturedPlayerIds: []
    };
  }

  if (redPlayers.length === 1) {
    const redPlayer = redPlayers[0];
    if (redPlayer.finishRank === 1) {
      return {
        outcome: "red_capture",
        winner: "red",
        message: "红十第一名出完，红十方抓全部。",
        capturedPlayerIds: normalPlayers.map((player) => player.id)
      };
    }

    return {
      outcome: "draw",
      winner: "none",
      message: "单红十没有第一名出完，本局平局。",
      capturedPlayerIds: []
    };
  }

  const topSlice = rankedPlayers.slice(0, redPlayers.length);
  const bottomSlice = rankedPlayers.slice(-redPlayers.length);
  const redTookTop = topSlice.every((player) => redIds.has(player.id));
  const redTookBottom = bottomSlice.every((player) => redIds.has(player.id));

  if (redTookTop) {
    return {
      outcome: "red_capture",
      winner: "red",
      message: "红十方包揽前几名，普通方全被抓。",
      capturedPlayerIds: normalPlayers.map((player) => player.id)
    };
  }

  if (redTookBottom) {
    return {
      outcome: "normal_capture",
      winner: "normal",
      message: "红十方全部垫底，红十方被抓。",
      capturedPlayerIds: redPlayers.map((player) => player.id)
    };
  }

  return {
    outcome: "draw",
    winner: "none",
    message: "双方名次交错，本局平局。",
    capturedPlayerIds: []
  };
}

function makePlay(
  cards: Card[],
  type: PlayType,
  rankValue: number,
  bombPower: number,
  label: string,
  isJokerBomb = false
): Play {
  return {
    cards,
    type,
    rankValue,
    length: cards.length,
    bombPower: type === "bomb" ? bombPower : undefined,
    isJokerBomb: type === "bomb" ? isJokerBomb : undefined,
    label
  };
}

function groupByRank(cards: Card[]): Group[] {
  const grouped = new Map<string, Card[]>();
  for (const card of cards) {
    if (card.rank === "JOKER") {
      const key = `JOKER-${card.jokerType}`;
      grouped.set(key, [...(grouped.get(key) ?? []), card]);
    } else {
      grouped.set(card.rank, [...(grouped.get(card.rank) ?? []), card]);
    }
  }

  return Array.from(grouped.entries())
    .map(([rankKey, rankCards]) => {
      const rank = rankKey.startsWith("JOKER") ? "JOKER" : (rankKey as Rank);
      return {
        rank,
        value: rank === "JOKER" ? getCardValue(rankCards[0]) : getRankValue(rank),
        cards: rankCards
      };
    })
    .sort((left, right) => left.value - right.value);
}

function analyzeStraight(cards: Card[], groups: Group[]): Play | undefined {
  if (cards.length < 3) return undefined;
  if (groups.length !== cards.length) return undefined;
  if (groups.some((group) => !canRankEnterSequence(group))) return undefined;
  if (!isConsecutive(groups.map((group) => group.value))) return undefined;

  return makePlay(cards, "straight", groups[groups.length - 1].value, 0, "顺子");
}

function analyzeGroupedSequence(
  cards: Card[],
  groups: Group[],
  groupSize: 2 | 3,
  type: Extract<PlayType, "consecutive_pairs" | "triple_sequence">
): Play | undefined {
  const minimumGroupCount = 3;
  if (groups.length < minimumGroupCount) return undefined;
  if (cards.length !== groups.length * groupSize) return undefined;
  if (groups.some((group) => group.cards.length !== groupSize || !canRankEnterSequence(group))) {
    return undefined;
  }
  if (!isConsecutive(groups.map((group) => group.value))) return undefined;

  return makePlay(
    cards,
    type,
    groups[groups.length - 1].value,
    0,
    type === "consecutive_pairs" ? "连对" : "三连"
  );
}

function canRankEnterSequence(group: Group): boolean {
  return group.rank !== "JOKER" && group.value >= 3 && group.value <= 14;
}

function isConsecutive(values: number[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] !== values[index - 1] + 1) {
      return false;
    }
  }
  return true;
}

function compareBomb(candidate: Play, current: Play): number {
  const candidatePower = candidate.bombPower ?? 0;
  const currentPower = current.bombPower ?? 0;

  if (candidatePower !== currentPower) {
    return candidatePower - currentPower;
  }

  if (candidate.isJokerBomb && !current.isJokerBomb) return 1;
  if (!candidate.isJokerBomb && current.isJokerBomb) return -1;
  if (candidate.isJokerBomb && current.isJokerBomb) return 0;

  return candidate.rankValue - current.rankValue;
}
