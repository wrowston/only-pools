import { describe, expect, it } from "vitest";
import {
  CANONICAL_NFL_TEAM_ABBREVIATIONS,
  CANONICAL_NFL_TEAMS,
} from "./catalog";

describe("canonical NFL Team catalog", () => {
  it("contains exactly the approved 32 canonical abbreviations", () => {
    expect(CANONICAL_NFL_TEAM_ABBREVIATIONS).toEqual([
      "ARI",
      "ATL",
      "BAL",
      "BUF",
      "CAR",
      "CHI",
      "CIN",
      "CLE",
      "DAL",
      "DEN",
      "DET",
      "GB",
      "HOU",
      "IND",
      "JAX",
      "KC",
      "LAC",
      "LAR",
      "LV",
      "MIA",
      "MIN",
      "NE",
      "NO",
      "NYG",
      "NYJ",
      "PHI",
      "PIT",
      "SEA",
      "SF",
      "TB",
      "TEN",
      "WAS",
    ]);
    expect(Object.keys(CANONICAL_NFL_TEAMS)).toHaveLength(32);
  });

  it("retains checked-in artwork without provider identity fields", () => {
    expect(CANONICAL_NFL_TEAMS.DET).toEqual({
      stableKey: "nfl-team:franchise-11",
      abbreviation: "DET",
      name: "Detroit Lions",
      logoUrl:
        "https://r2.thesportsdb.com/images/media/team/badge/lgsgkr1546168257.png",
    });
    expect(CANONICAL_NFL_TEAMS.DET).not.toHaveProperty("providerId");
    expect(CANONICAL_NFL_TEAMS.DET).not.toHaveProperty("sportsDbTeamId");
  });

  it("retains the approved artwork URL for every NFL Team", () => {
    expect(
      Object.fromEntries(
        CANONICAL_NFL_TEAM_ABBREVIATIONS.map((abbreviation) => [
          abbreviation,
          CANONICAL_NFL_TEAMS[abbreviation].logoUrl,
        ]),
      ),
    ).toEqual({
      ARI: "https://r2.thesportsdb.com/images/media/team/badge/xvuwtw1420646838.png",
      ATL: "https://r2.thesportsdb.com/images/media/team/badge/rrpvpr1420658174.png",
      BAL: "https://r2.thesportsdb.com/images/media/team/badge/einz3p1546172463.png",
      BUF: "https://r2.thesportsdb.com/images/media/team/badge/6pb37b1515849026.png",
      CAR: "https://r2.thesportsdb.com/images/media/team/badge/xxyvvy1420940478.png",
      CHI: "https://r2.thesportsdb.com/images/media/team/badge/ji22531698678538.png",
      CIN: "https://r2.thesportsdb.com/images/media/team/badge/qqtwwv1420941670.png",
      CLE: "https://r2.thesportsdb.com/images/media/team/badge/squvxy1420942389.png",
      DAL: "https://r2.thesportsdb.com/images/media/team/badge/wrxssu1450018209.png",
      DEN: "https://r2.thesportsdb.com/images/media/team/badge/upsspx1421635647.png",
      DET: "https://r2.thesportsdb.com/images/media/team/badge/lgsgkr1546168257.png",
      GB: "https://r2.thesportsdb.com/images/media/team/badge/rqpwtr1421434717.png",
      HOU: "https://r2.thesportsdb.com/images/media/team/badge/wqyryy1421436627.png",
      IND: "https://r2.thesportsdb.com/images/media/team/badge/wqqvpx1421434058.png",
      JAX: "https://r2.thesportsdb.com/images/media/team/badge/0mrsd41546427902.png",
      KC: "https://r2.thesportsdb.com/images/media/team/badge/936t161515847222.png",
      LAC: "https://r2.thesportsdb.com/images/media/team/badge/vrqanp1687734910.png",
      LAR: "https://r2.thesportsdb.com/images/media/team/badge/8e8v4i1599764614.png",
      LV: "https://r2.thesportsdb.com/images/media/team/badge/xqusqy1421724291.png",
      MIA: "https://r2.thesportsdb.com/images/media/team/badge/trtusv1421435081.png",
      MIN: "https://r2.thesportsdb.com/images/media/team/badge/qstqqr1421609163.png",
      NE: "https://r2.thesportsdb.com/images/media/team/badge/xtwxyt1421431860.png",
      NO: "https://r2.thesportsdb.com/images/media/team/badge/nd46c71537821337.png",
      NYG: "https://r2.thesportsdb.com/images/media/team/badge/vxppup1423669459.png",
      NYJ: "https://r2.thesportsdb.com/images/media/team/badge/hz92od1607953467.png",
      PHI: "https://r2.thesportsdb.com/images/media/team/badge/pnpybf1515852421.png",
      PIT: "https://r2.thesportsdb.com/images/media/team/badge/2975411515853129.png",
      SEA: "https://r2.thesportsdb.com/images/media/team/badge/wwuqyr1421434817.png",
      SF: "https://r2.thesportsdb.com/images/media/team/badge/bqbtg61539537328.png",
      TB: "https://r2.thesportsdb.com/images/media/team/badge/2dfpdl1537820969.png",
      TEN: "https://r2.thesportsdb.com/images/media/team/badge/3td0f41779180767.png",
      WAS: "https://r2.thesportsdb.com/images/media/team/badge/rn0c7v1643826119.png",
    });
  });
});
