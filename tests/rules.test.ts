import { describe, expect, it } from "vitest";
import { buildDeck } from "../src/shared/cards";
import { analyzePlay, calculateResult, canBeat } from "../src/shared/rules";
import type { Card, Player } from "../src/shared/types";

const deck = buildDeck(6);

function c(id: string): Card {
  const card = deck.find((item) => item.id === id);
  if (!card) throw new Error(`Missing test card: ${id}`);
  return card;
}

describe("play analysis", () => {
  it("recognizes three-card straight and excludes 2 from sequence", () => {
    const play = analyzePlay([c("1-spades-10"), c("1-hearts-J"), c("1-clubs-Q")]);
    expect(play.type).toBe("straight");
    expect(play.length).toBe(3);

    expect(() => analyzePlay([c("1-spades-A"), c("1-hearts-2"), c("1-clubs-K")])).toThrow();
  });

  it("recognizes consecutive pairs and requires three pairs", () => {
    const play = analyzePlay([
      c("1-spades-6"),
      c("1-hearts-6"),
      c("1-spades-7"),
      c("1-hearts-7"),
      c("1-spades-8"),
      c("1-hearts-8")
    ]);
    expect(play.type).toBe("consecutive_pairs");

    expect(() =>
      analyzePlay([c("1-spades-6"), c("1-hearts-6"), c("1-spades-7"), c("1-hearts-7")])
    ).toThrow();
  });

  it("recognizes triple sequence and treats standalone triples as bombs", () => {
    const tripleSequence = analyzePlay([
      c("1-spades-3"),
      c("1-hearts-3"),
      c("1-clubs-3"),
      c("1-spades-4"),
      c("1-hearts-4"),
      c("1-clubs-4"),
      c("1-spades-5"),
      c("1-hearts-5"),
      c("1-clubs-5")
    ]);
    expect(tripleSequence.type).toBe("triple_sequence");

    const bomb = analyzePlay([c("1-spades-9"), c("1-hearts-9"), c("1-clubs-9")]);
    expect(bomb.type).toBe("bomb");
    expect(bomb.bombPower).toBe(3);
  });

  it("compares regular bombs by size then rank", () => {
    const tripleBomb = analyzePlay([c("1-spades-9"), c("1-hearts-9"), c("1-clubs-9")]);
    const fourBomb = analyzePlay([
      c("1-spades-3"),
      c("1-hearts-3"),
      c("1-clubs-3"),
      c("1-diamonds-3")
    ]);
    const biggerTripleBomb = analyzePlay([c("1-spades-10"), c("1-hearts-10"), c("1-clubs-10")]);

    expect(canBeat(fourBomb, tripleBomb)).toBe(true);
    expect(canBeat(biggerTripleBomb, tripleBomb)).toBe(true);
    expect(canBeat(tripleBomb, fourBomb)).toBe(false);
  });

  it("folds joker bombs into doubled bomb power", () => {
    const fourBomb = analyzePlay([
      c("1-spades-A"),
      c("1-hearts-A"),
      c("1-clubs-A"),
      c("1-diamonds-A")
    ]);
    const doubleJoker = analyzePlay([c("1-joker-small"), c("1-joker-big")]);
    const tripleJoker = analyzePlay([c("1-joker-small"), c("1-joker-big"), c("2-joker-small")]);

    expect(doubleJoker.bombPower).toBe(4);
    expect(tripleJoker.bombPower).toBe(6);
    expect(canBeat(doubleJoker, fourBomb)).toBe(true);
    expect(canBeat(tripleJoker, doubleJoker)).toBe(true);
  });

  it("requires same type and same length for normal plays", () => {
    const shortStraight = analyzePlay([c("1-spades-7"), c("1-hearts-8"), c("1-clubs-9")]);
    const longStraight = analyzePlay([
      c("1-spades-8"),
      c("1-hearts-9"),
      c("1-clubs-10"),
      c("1-diamonds-J")
    ]);
    const higherStraight = analyzePlay([c("1-spades-8"), c("1-hearts-9"), c("1-clubs-10")]);

    expect(canBeat(longStraight, shortStraight)).toBe(false);
    expect(canBeat(higherStraight, shortStraight)).toBe(true);
  });
});

describe("result calculation", () => {
  it("captures all when a single red player finishes first", () => {
    const result = calculateResult([
      p("red", true, 1),
      p("n1", false, 2),
      p("n2", false, 3)
    ]);
    expect(result.outcome).toBe("red_capture");
    expect(result.capturedPlayerIds).toEqual(["n1", "n2"]);
  });

  it("draws when a single red player is not first", () => {
    const result = calculateResult([
      p("n1", false, 1),
      p("red", true, 2),
      p("n2", false, 3)
    ]);
    expect(result.outcome).toBe("draw");
  });

  it("captures normal side when red players take the top ranks", () => {
    const result = calculateResult([
      p("r1", true, 1),
      p("r2", true, 2),
      p("n1", false, 3),
      p("n2", false, 4)
    ]);
    expect(result.outcome).toBe("red_capture");
  });

  it("captures red side when red players take the bottom ranks", () => {
    const result = calculateResult([
      p("n1", false, 1),
      p("n2", false, 2),
      p("r1", true, 3),
      p("r2", true, 4)
    ]);
    expect(result.outcome).toBe("normal_capture");
  });

  it("draws on mixed rankings", () => {
    const result = calculateResult([
      p("n1", false, 1),
      p("r1", true, 2),
      p("n2", false, 3),
      p("r2", true, 4)
    ]);
    expect(result.outcome).toBe("draw");
  });
});

function p(id: string, isRedTeam: boolean, finishRank: number): Player {
  return {
    id,
    nickname: id,
    seat: finishRank - 1,
    hand: [],
    isRedTeam,
    isRevealed: false,
    finishRank
  };
}
