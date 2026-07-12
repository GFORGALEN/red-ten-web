import type { Card, JokerType, Rank, RoomOptions, Suit } from "./types";

export const suits: Suit[] = ["spades", "hearts", "clubs", "diamonds"];
export const ranks: Exclude<Rank, "JOKER">[] = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2"
];

const rankValues: Record<Rank, number> = {
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  "2": 15,
  JOKER: 0
};

export function getCardValue(card: Card): number {
  if (card.rank === "JOKER") {
    return card.jokerType === "big" ? 17 : 16;
  }
  return rankValues[card.rank];
}

export function getRankValue(rank: Rank): number {
  return rankValues[rank];
}

export function buildDeck(deckCount: number): Card[] {
  const cards: Card[] = [];

  for (let deckId = 1; deckId <= deckCount; deckId += 1) {
    for (const suit of suits) {
      for (const rank of ranks) {
        cards.push({
          id: `${deckId}-${suit}-${rank}`,
          deckId,
          suit,
          rank
        });
      }
    }

    for (const jokerType of ["small", "big"] satisfies JokerType[]) {
      cards.push({
        id: `${deckId}-joker-${jokerType}`,
        deckId,
        rank: "JOKER",
        jokerType
      });
    }
  }

  return cards;
}

export function shuffleCards(cards: Card[]): Card[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((left, right) => {
    const valueDiff = getCardValue(left) - getCardValue(right);
    if (valueDiff !== 0) return valueDiff;
    return left.id.localeCompare(right.id);
  });
}

export function isHeartTen(card: Card): boolean {
  return card.suit === "hearts" && card.rank === "10";
}

export function isHeartThree(card: Card): boolean {
  return card.suit === "hearts" && card.rank === "3";
}

export function validateRoomOptions(options: RoomOptions): RoomOptions {
  const playerCount = Math.floor(Number(options.playerCount));
  const deckCount = Math.floor(Number(options.deckCount));

  if (!Number.isFinite(playerCount) || playerCount < 2 || playerCount > 10) {
    throw new Error("人数必须在 2 到 10 之间。");
  }

  if (!Number.isFinite(deckCount) || deckCount < 1 || deckCount > 6) {
    throw new Error("牌副数必须在 1 到 6 之间。");
  }

  return { playerCount, deckCount };
}

export function cardText(card: Card): string {
  if (card.rank === "JOKER") {
    return card.jokerType === "big" ? "大王" : "小王";
  }

  const suitText: Record<Suit, string> = {
    spades: "黑桃",
    hearts: "红桃",
    clubs: "梅花",
    diamonds: "方片"
  };

  return `${suitText[card.suit!]}${card.rank}`;
}

export function cardShortText(card: Card): string {
  if (card.rank === "JOKER") {
    return card.jokerType === "big" ? "大王" : "小王";
  }

  const suitText: Record<Suit, string> = {
    spades: "♠",
    hearts: "♥",
    clubs: "♣",
    diamonds: "♦"
  };

  return `${suitText[card.suit!]}${card.rank}`;
}
