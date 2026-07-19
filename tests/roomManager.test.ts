import { describe, expect, it } from "vitest";
import { buildDeck } from "../src/shared/cards";
import { RoomRuntime } from "../src/server/roomManager";
import type { Card } from "../src/shared/types";

const deck = buildDeck(3);

function card(id: string): Card {
  const found = deck.find((item) => item.id === id);
  if (!found) throw new Error(`Missing card ${id}`);
  return found;
}

describe("room finish timing", () => {
  it("finishes immediately when the only red-ten player goes out first", () => {
    const room = new RoomRuntime(
      "TEST1",
      { playerCount: 3, deckCount: 2 },
      { id: "red", nickname: "red" },
      () => undefined,
      () => undefined
    );

    room.join("n1", "n1");
    room.join("n2", "n2");

    const red = room.state.players.find((player) => player.id === "red")!;
    const n1 = room.state.players.find((player) => player.id === "n1")!;
    const n2 = room.state.players.find((player) => player.id === "n2")!;

    red.hand = [card("1-hearts-10"), card("2-hearts-10")];
    red.isRedTeam = true;
    n1.hand = [card("1-spades-3")];
    n1.isRedTeam = false;
    n2.hand = [card("1-clubs-3")];
    n2.isRedTeam = false;

    room.state.phase = "playing";
    room.state.currentTurn = "red";

    room.playCards("red", red.hand.map((item) => item.id));

    expect(room.state.phase).toBe("finished");
    expect(room.state.result?.outcome).toBe("red_capture");
    expect(room.state.result?.capturedPlayerIds).toEqual(["n1", "n2"]);
  });

  it("runs tribute before the next captured round starts", () => {
    const room = new RoomRuntime(
      "TEST2",
      { playerCount: 3, deckCount: 2 },
      { id: "red", nickname: "red" },
      () => undefined,
      () => undefined
    );

    room.join("n1", "n1");
    room.join("n2", "n2");
    room.state.phase = "finished";
    room.state.result = {
      outcome: "red_capture",
      winner: "red",
      message: "red captured",
      capturedPlayerIds: ["n1", "n2"]
    };
    room.state.players.find((player) => player.id === "red")!.finishRank = 1;
    room.state.players.find((player) => player.id === "n1")!.finishRank = 2;
    room.state.players.find((player) => player.id === "n2")!.finishRank = 3;

    (room as unknown as { dealCards: () => void }).dealCards = () => {
      const red = room.state.players.find((player) => player.id === "red")!;
      const n1 = room.state.players.find((player) => player.id === "n1")!;
      const n2 = room.state.players.find((player) => player.id === "n2")!;
      red.hand = [card("1-spades-3"), card("1-hearts-4")];
      red.isRedTeam = true;
      n1.hand = [card("1-spades-2"), card("1-hearts-A"), card("1-clubs-K")];
      n1.isRedTeam = false;
      n2.hand = [card("1-diamonds-2"), card("1-clubs-A"), card("1-diamonds-K")];
      n2.isRedTeam = false;
    };

    room.start("red");

    expect(room.state.phase).toBe("tribute");
    expect(room.state.tribute?.currentPickerId).toBe("red");
    expect(room.state.tribute?.pool).toHaveLength(4);

    while (room.state.tribute?.pool.length) {
      room.pickTribute("red", room.state.tribute.pool[0].card.id);
    }

    expect(room.state.tribute?.currentReturnerId).toBe("red");

    const red = room.state.players.find((player) => player.id === "red")!;
    room.returnTribute("red", red.hand.slice(0, 4).map((item) => item.id));

    expect(room.state.phase).toBe("playing");
    expect(room.state.tribute).toBeUndefined();
    expect(room.state.currentTurn).toBeTruthy();
  });

  it("reverses tribute when a captured player is dealt three jokers", () => {
    const room = new RoomRuntime(
      "TEST3",
      { playerCount: 3, deckCount: 3 },
      { id: "red", nickname: "red" },
      () => undefined,
      () => undefined
    );

    room.join("n1", "n1");
    room.join("n2", "n2");
    room.state.phase = "finished";
    room.state.result = {
      outcome: "red_capture",
      winner: "red",
      message: "red captured",
      capturedPlayerIds: ["n1", "n2"]
    };
    room.state.players.find((player) => player.id === "red")!.finishRank = 1;
    room.state.players.find((player) => player.id === "n1")!.finishRank = 2;
    room.state.players.find((player) => player.id === "n2")!.finishRank = 3;

    (room as unknown as { dealCards: () => void }).dealCards = () => {
      const red = room.state.players.find((player) => player.id === "red")!;
      const n1 = room.state.players.find((player) => player.id === "n1")!;
      const n2 = room.state.players.find((player) => player.id === "n2")!;
      red.hand = [card("1-spades-2"), card("1-hearts-A"), card("1-clubs-K")];
      red.isRedTeam = true;
      n1.hand = [card("1-joker-big"), card("1-joker-small"), card("2-joker-small"), card("1-spades-3")];
      n1.isRedTeam = false;
      n2.hand = [card("1-clubs-3")];
      n2.isRedTeam = false;
    };

    room.start("red");

    expect(room.state.phase).toBe("tribute");
    expect(room.state.tribute?.isReversed).toBe(true);
    expect(room.state.tribute?.winnerIds).toEqual(["n1"]);
    expect(room.state.tribute?.capturedPlayerIds).toEqual(["red"]);
    expect(room.state.tribute?.currentPickerId).toBe("n1");
    expect(room.state.tribute?.pool.map((pick) => pick.fromPlayerId)).toEqual(["red", "red"]);
  });

  it("finishes immediately when multiple red-ten players take the top ranks", () => {
    const room = new RoomRuntime(
      "TEST4",
      { playerCount: 4, deckCount: 2 },
      { id: "r1", nickname: "r1" },
      () => undefined,
      () => undefined
    );

    room.join("r2", "r2");
    room.join("n1", "n1");
    room.join("n2", "n2");

    const r1 = room.state.players.find((player) => player.id === "r1")!;
    const r2 = room.state.players.find((player) => player.id === "r2")!;
    const n1 = room.state.players.find((player) => player.id === "n1")!;
    const n2 = room.state.players.find((player) => player.id === "n2")!;

    r1.hand = [];
    r1.isRedTeam = true;
    r1.finishRank = 1;
    room.state.finishOrder = ["r1"];
    r2.hand = [card("1-spades-3")];
    r2.isRedTeam = true;
    n1.hand = [card("1-clubs-3")];
    n1.isRedTeam = false;
    n2.hand = [card("1-diamonds-3")];
    n2.isRedTeam = false;
    room.state.phase = "playing";
    room.state.currentTurn = "r2";

    room.playCards("r2", r2.hand.map((item) => item.id));

    expect(room.state.phase).toBe("finished");
    expect(room.state.result?.outcome).toBe("red_capture");
    expect(room.state.result?.capturedPlayerIds).toEqual(["n1", "n2"]);
  });

  it("finishes immediately when normal players take the top ranks against multiple red-ten players", () => {
    const room = new RoomRuntime(
      "TEST5",
      { playerCount: 4, deckCount: 2 },
      { id: "n1", nickname: "n1" },
      () => undefined,
      () => undefined
    );

    room.join("n2", "n2");
    room.join("r1", "r1");
    room.join("r2", "r2");

    const n1 = room.state.players.find((player) => player.id === "n1")!;
    const n2 = room.state.players.find((player) => player.id === "n2")!;
    const r1 = room.state.players.find((player) => player.id === "r1")!;
    const r2 = room.state.players.find((player) => player.id === "r2")!;

    n1.hand = [];
    n1.isRedTeam = false;
    n1.finishRank = 1;
    room.state.finishOrder = ["n1"];
    n2.hand = [card("1-spades-3")];
    n2.isRedTeam = false;
    r1.hand = [card("1-clubs-3")];
    r1.isRedTeam = true;
    r2.hand = [card("1-diamonds-3")];
    r2.isRedTeam = true;
    room.state.phase = "playing";
    room.state.currentTurn = "n2";

    room.playCards("n2", n2.hand.map((item) => item.id));

    expect(room.state.phase).toBe("finished");
    expect(room.state.result?.outcome).toBe("normal_capture");
    expect(room.state.result?.capturedPlayerIds).toEqual(["r1", "r2"]);
  });

  it("passes the lead to the next unfinished player when the last-play player is out", () => {
    const room = new RoomRuntime(
      "TEST6",
      { playerCount: 4, deckCount: 2 },
      { id: "n1", nickname: "n1" },
      () => undefined,
      () => undefined
    );

    room.join("n2", "n2");
    room.join("r1", "r1");
    room.join("r2", "r2");

    const n1 = room.state.players.find((player) => player.id === "n1")!;
    const n2 = room.state.players.find((player) => player.id === "n2")!;
    const r1 = room.state.players.find((player) => player.id === "r1")!;
    const r2 = room.state.players.find((player) => player.id === "r2")!;

    n1.hand = [card("1-spades-3")];
    n1.isRedTeam = false;
    n2.hand = [card("1-clubs-4")];
    n2.isRedTeam = false;
    r1.hand = [card("1-clubs-5")];
    r1.isRedTeam = true;
    r2.hand = [card("1-diamonds-6")];
    r2.isRedTeam = true;
    room.state.phase = "playing";
    room.state.currentTurn = "n1";

    room.playCards("n1", n1.hand.map((item) => item.id));
    room.pass("n2");
    room.pass("r1");
    room.pass("r2");

    expect(room.state.phase).toBe("playing");
    expect(room.state.lastPlay).toBeUndefined();
    expect(room.state.currentTurn).toBe("n2");
  });

  it("rejects returning the wrong number of tribute cards", () => {
    const room = new RoomRuntime(
      "TEST7",
      { playerCount: 3, deckCount: 2 },
      { id: "red", nickname: "red" },
      () => undefined,
      () => undefined
    );

    room.join("n1", "n1");
    room.join("n2", "n2");
    room.state.phase = "finished";
    room.state.result = {
      outcome: "red_capture",
      winner: "red",
      message: "red captured",
      capturedPlayerIds: ["n1", "n2"]
    };
    room.state.players.find((player) => player.id === "red")!.finishRank = 1;
    room.state.players.find((player) => player.id === "n1")!.finishRank = 2;
    room.state.players.find((player) => player.id === "n2")!.finishRank = 3;

    (room as unknown as { dealCards: () => void }).dealCards = () => {
      const red = room.state.players.find((player) => player.id === "red")!;
      const n1 = room.state.players.find((player) => player.id === "n1")!;
      const n2 = room.state.players.find((player) => player.id === "n2")!;
      red.hand = [card("1-spades-3"), card("1-hearts-4")];
      red.isRedTeam = true;
      n1.hand = [card("1-spades-2"), card("1-hearts-A")];
      n1.isRedTeam = false;
      n2.hand = [card("1-diamonds-2"), card("1-clubs-A")];
      n2.isRedTeam = false;
    };

    room.start("red");
    while (room.state.tribute?.pool.length) {
      room.pickTribute("red", room.state.tribute.pool[0].card.id);
    }

    const red = room.state.players.find((player) => player.id === "red")!;
    expect(() => room.returnTribute("red", red.hand.slice(0, 3).map((item) => item.id))).toThrow();
    expect(room.state.phase).toBe("tribute");
  });

  it("reveals red-ten identity automatically when heart ten is played", () => {
    const room = new RoomRuntime(
      "TEST8",
      { playerCount: 3, deckCount: 2 },
      { id: "red", nickname: "red" },
      () => undefined,
      () => undefined
    );

    room.join("n1", "n1");
    room.join("n2", "n2");
    const red = room.state.players.find((player) => player.id === "red")!;
    red.hand = [card("1-hearts-10"), card("1-spades-4")];
    red.isRedTeam = true;
    red.isRevealed = false;
    room.state.players.find((player) => player.id === "n1")!.isRedTeam = false;
    room.state.players.find((player) => player.id === "n2")!.isRedTeam = false;
    room.state.phase = "playing";
    room.state.currentTurn = "red";

    room.playCards("red", [card("1-hearts-10").id]);

    expect(red.isRevealed).toBe(true);
    expect(room.state.phase).toBe("playing");
  });
});
