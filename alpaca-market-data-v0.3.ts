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
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  try {
    const apiKey = Deno.env.get("ALPACA_API_KEY")?.trim();
    const secretKey = Deno.env.get("ALPACA_SECRET_KEY")?.trim();

    if (!apiKey || !secretKey) {
      return json({
        ok: false,
        stage: "credentials",
        error: "Alpaca API keys are missing",
      }, 500);
    }

    const headers = {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": secretKey,
    };

    // 先抓 Snapshot
    const snapshotUrl =
      "https://data.alpaca.markets/v2/stocks/SNDK/snapshot?feed=iex";

    const snapshotResponse = await fetch(snapshotUrl, { headers });

    if (!snapshotResponse.ok) {
      const body = await snapshotResponse.text();

      return json({
        ok: false,
        stage: "snapshot",
        alpacaStatus: snapshotResponse.status,
        error: body,
      }, 500);
    }

    const snapshot = await snapshotResponse.json();

    // 再抓最近 7 天的 5 分 K
    const start = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const barsUrl =
      `https://data.alpaca.markets/v2/stocks/SNDK/bars?timeframe=5Min&start=${encodeURIComponent(start)}&limit=100&feed=iex&sort=desc`;

    const barsResponse = await fetch(barsUrl, { headers });

    if (!barsResponse.ok) {
      const body = await barsResponse.text();

      return json({
        ok: false,
        stage: "bars",
        alpacaStatus: barsResponse.status,
        error: body,
      }, 500);
    }

    const barsData = await barsResponse.json();
    const bars = Array.isArray(barsData.bars)
      ? [...barsData.bars].reverse()
      : [];

    // EMA
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

    // RSI
    const calculateRSI = (values: number[], period = 14) => {
      if (values.length <= period) return null;

      let gains = 0;
      let losses = 0;

      for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];

        if (change >= 0) {
          gains += change;
        } else {
          losses += Math.abs(change);
        }
      }

      let avgGain = gains / period;
      let avgLoss = losses / period;

      for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);

        avgGain =
          (avgGain * (period - 1) + gain) / period;

        avgLoss =
          (avgLoss * (period - 1) + loss) / period;
      }

      if (avgLoss === 0) {
        return avgGain === 0 ? 50 : 100;
      }

      const rs = avgGain / avgLoss;

      return 100 - 100 / (1 + rs);
    };

    const closes = bars
      .map((bar: any) => Number(bar.c))
      .filter((value: number) => Number.isFinite(value));

    const ema9 = calculateEMA(closes, 9);
    const ema20 = calculateEMA(closes, 20);
    const rsi14 = calculateRSI(closes, 14);

    return json({
      ok: true,
      stage: "complete",

      symbol: "SNDK",
      feed: "iex",
      timeframe: "5Min",

      latestTrade: snapshot.latestTrade ?? null,
      dailyBar: snapshot.dailyBar ?? null,
      prevDailyBar: snapshot.prevDailyBar ?? null,

      barCount: bars.length,

      indicators: {
        ema9,
        ema20,
        rsi14,
      },

      bars,
    });
  } catch (error) {
    return json({
      ok: false,
      stage: "unexpected",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      stack:
        error instanceof Error
          ? error.stack
          : null,
    }, 500);
  }
});
