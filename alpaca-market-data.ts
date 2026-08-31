const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const calculateEMA = (values: number[], period: number) => {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) /
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

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;

  return 100 - 100 / (1 + avgGain / avgLoss);
};

const readBars = (data: unknown) => {
  if (
    typeof data !== "object" || data === null ||
    !("bars" in data) || !Array.isArray(data.bars)
  ) {
    return [];
  }

  // Alpaca returns descending bars for these requests; expose oldest to newest.
  return [...data.bars].reverse();
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
    const stockUrl = `https://data.alpaca.markets/v2/stocks/${symbol}`;
    const barsUrl = (timeframe: string) =>
      `${stockUrl}/bars?timeframe=${timeframe}` +
      `&start=${encodeURIComponent(start)}&limit=100&feed=${feed}&sort=desc`;

    // Keep v0.4's parallel upstream requests to minimize total response time.
    const requests = [
      {
        stage: "snapshot",
        response: fetch(`${stockUrl}/snapshot?feed=${feed}`, {
          headers: alpacaHeaders,
        }),
      },
      {
        stage: "1Min",
        response: fetch(barsUrl("1Min"), { headers: alpacaHeaders }),
      },
      {
        stage: "5Min",
        response: fetch(barsUrl("5Min"), { headers: alpacaHeaders }),
      },
    ];
    const responses = await Promise.all(
      requests.map(({ response }) => response),
    );

    for (let i = 0; i < responses.length; i++) {
      if (!responses[i].ok) {
        const error = await responses[i].text();
        return json(
          {
            ok: false,
            stage: requests[i].stage,
            status: responses[i].status,
            // v0.3 compatibility for existing diagnostics consumers.
            alpacaStatus: responses[i].status,
            error,
          },
          responses[i].status,
        );
      }
    }

    const [snapshot, bars1MinData, bars5MinData] = await Promise.all(
      responses.map((response) => response.json()),
    );
    const bars1Min = readBars(bars1MinData);
    const bars5Min = readBars(bars5MinData);
    const closes = bars5Min
      .map((bar) =>
        typeof bar === "object" && bar !== null && "c" in bar
          ? Number(bar.c)
          : Number.NaN
      )
      .filter(Number.isFinite);
    const snapshotData = typeof snapshot === "object" && snapshot !== null
      ? snapshot as Record<string, unknown>
      : {};

    return json({
      ok: true,
      stage: "complete",
      version: "0.4-rc.1",
      symbol,
      feed,

      // Preserve the v0.3 top-level response consumed by the current index.html.
      timeframe: "5Min",
      latestTrade: snapshotData.latestTrade ?? null,
      dailyBar: snapshotData.dailyBar ?? null,
      prevDailyBar: snapshotData.prevDailyBar ?? null,
      barCount: bars5Min.length,
      indicators: {
        ema9: calculateEMA(closes, 9),
        ema20: calculateEMA(closes, 20),
        rsi14: calculateRSI(closes, 14),
      },
      bars: bars5Min,

      // Retain v0.4's structured multi-timeframe response for new consumers.
      snapshot: snapshotData,
      timeframes: {
        "1Min": { barCount: bars1Min.length, bars: bars1Min },
        "5Min": { barCount: bars5Min.length, bars: bars5Min },
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
