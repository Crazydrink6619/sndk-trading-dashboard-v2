Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });

  const finiteCloses = (bars: Array<{ c?: number }>) =>
    bars
      .map((bar) => Number(bar.c))
      .filter((value) => Number.isFinite(value));

  const calculateEMA = (values: number[], period: number) => {
    if (values.length < period) return null;

    const multiplier = 2 / (period + 1);
    let ema =
      values.slice(0, period).reduce((sum, value) => sum + value, 0) /
      period;

    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
  };

  const calculateRSI = (values: number[], period = 14) => {
    if (values.length <= period) return null;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = values[i] - values[i - 1];
      gains += Math.max(change, 0);
      losses += Math.max(-change, 0);
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    for (let i = period + 1; i < values.length; i++) {
      const change = values[i] - values[i - 1];
      averageGain =
        (averageGain * (period - 1) + Math.max(change, 0)) / period;
      averageLoss =
        (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    }

    if (averageLoss === 0) {
      return averageGain === 0 ? 50 : 100;
    }

    return 100 - 100 / (1 + averageGain / averageLoss);
  };

  const calculateIndicators = (
    bars: Array<{ c?: number; t?: string }>,
  ) => {
    const closes = finiteCloses(bars);
    const latestClose = closes.at(-1) ?? null;
    const previousClose = closes.at(-2) ?? null;
    const momentumPct =
      latestClose != null && previousClose != null && previousClose !== 0
        ? ((latestClose - previousClose) / previousClose) * 100
        : null;

    return {
      ema9: calculateEMA(closes, 9),
      ema20: calculateEMA(closes, 20),
      rsi14: calculateRSI(closes, 14),
      momentumPct,
      latestBarTimestamp: bars.at(-1)?.t ?? null,
    };
  };

  try {
    const apiKey = Deno.env.get("ALPACA_API_KEY")?.trim();
    const secretKey = Deno.env.get("ALPACA_SECRET_KEY")?.trim();

    if (!apiKey || !secretKey) {
      return json(
        {
          ok: false,
          stage: "credentials",
          error: "Alpaca API keys are missing",
        },
        500,
      );
    }

    const symbol = "SNDK";
    const feed = "iex";
    const start = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const alpacaHeaders = {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": secretKey,
    };

    const snapshotUrl =
      `https://data.alpaca.markets/v2/stocks/${symbol}/snapshot?feed=${feed}`;
    const barsUrl = (timeframe: "1Min" | "5Min") =>
      `https://data.alpaca.markets/v2/stocks/${symbol}/bars` +
      `?timeframe=${timeframe}` +
      `&start=${encodeURIComponent(start)}` +
      "&limit=100" +
      `&feed=${feed}` +
      "&sort=desc";

    const [snapshotResponse, bars1MinResponse, bars5MinResponse] =
      await Promise.all([
        fetch(snapshotUrl, { headers: alpacaHeaders }),
        fetch(barsUrl("1Min"), { headers: alpacaHeaders }),
        fetch(barsUrl("5Min"), { headers: alpacaHeaders }),
      ]);

    const responses = [
      ["snapshot", snapshotResponse],
      ["1Min", bars1MinResponse],
      ["5Min", bars5MinResponse],
    ] as const;

    for (const [stage, response] of responses) {
      if (!response.ok) {
        return json(
          {
            ok: false,
            stage,
            status: response.status,
            error: await response.text(),
          },
          response.status,
        );
      }
    }

    const snapshot = await snapshotResponse.json();
    const bars1MinData = await bars1MinResponse.json();
    const bars5MinData = await bars5MinResponse.json();

    const chronological = (
      value: unknown,
    ): Array<Record<string, number | string>> =>
      Array.isArray(value)
        ? [...value].sort(
          (a, b) =>
            new Date(String(a?.t ?? 0)).getTime() -
            new Date(String(b?.t ?? 0)).getTime(),
        )
        : [];

    const bars1Min = chronological(bars1MinData.bars);
    const bars5Min = chronological(bars5MinData.bars);
    const latestTrade = snapshot.latestTrade ?? null;
    const dailyBar = snapshot.dailyBar ?? null;
    const prevDailyBar = snapshot.prevDailyBar ?? null;

    return json({
      ok: true,
      version: "0.4",
      symbol,
      feed,
      marketDataTimestamp:
        latestTrade?.t ??
        bars1Min.at(-1)?.t ??
        bars5Min.at(-1)?.t ??
        dailyBar?.t ??
        null,
      latestTrade,
      latestQuote: snapshot.latestQuote ?? null,
      minuteBar: snapshot.minuteBar ?? null,
      dailyBar,
      prevDailyBar,
      snapshot,
      timeframes: {
        "1Min": {
          barCount: bars1Min.length,
          bars: bars1Min,
          indicators: calculateIndicators(bars1Min),
        },
        "5Min": {
          barCount: bars5Min.length,
          bars: bars5Min,
          indicators: calculateIndicators(bars5Min),
        },
      },
      latest: {
        "1Min": bars1Min.at(-1) ?? null,
        "5Min": bars5Min.at(-1) ?? null,
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "unexpected",
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
