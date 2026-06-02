'use client';

import { useCallback, useEffect, useState } from 'react';

type TradeStatus = 'open' | 'pending_close' | 'closed' | 'failed';
type TradeAction = 'BUY' | 'SELL' | 'HOLD';

interface Trade {
  id: string;
  action: TradeAction;
  token: string;
  amount_eth: number;
  entry_price: number;
  exit_price: number | null;
  pnl_usd: number | null;
  timestamp: number;
  status: TradeStatus;
  llm_reasoning: string;
  confidence: number;
}

interface Portfolio {
  eth_balance: number;
  usdc_balance: number;
  total_value_usd: number;
}

interface StatusData {
  status: string;
  portfolio: Portfolio;
  recentTrades: Trade[];
  recentPrices: number[];
  openTrades: Trade[];
  recentReasoning: string[];
}

const REFRESH_MS = 30_000;

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function usd(n: number) {
  return '$' + fmt(n, 2);
}

function priceTrend(prices: number[], i: number) {
  if (i >= prices.length - 1) return { symbol: '→', color: 'text-gray-500' };
  if (prices[i] > prices[i + 1]) return { symbol: '↑', color: 'text-green-400' };
  if (prices[i] < prices[i + 1]) return { symbol: '↓', color: 'text-red-400' };
  return { symbol: '→', color: 'text-gray-500' };
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">{title}</h2>
      {children}
    </div>
  );
}

function ActionBadge({ action }: { action: TradeAction }) {
  const cls: Record<TradeAction, string> = {
    BUY: 'bg-green-900/50 text-green-400 border border-green-800',
    SELL: 'bg-red-900/50 text-red-400 border border-red-800',
    HOLD: 'bg-yellow-900/50 text-yellow-400 border border-yellow-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${cls[action]}`}>{action}</span>
  );
}

function StatusPill({ status }: { status: TradeStatus }) {
  const cls: Record<TradeStatus, string> = {
    open: 'bg-blue-900/50 text-blue-400',
    pending_close: 'bg-yellow-900/50 text-yellow-400',
    closed: 'bg-gray-800 text-gray-400',
    failed: 'bg-red-900/50 text-red-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function PnlCell({ pnl }: { pnl: number | null }) {
  if (pnl === null) return <span className="text-gray-600">—</span>;
  const color = pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-gray-400';
  return <span className={color}>{pnl > 0 ? '+' : ''}{usd(pnl)}</span>;
}

export default function Dashboard() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: StatusData = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const ethPrice = data?.recentPrices?.[0] ?? 0;
  const isOnline = !error && data?.status === 'ok';

  return (
    <main className="min-h-screen p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Trader Agent</h1>
          <p className="text-gray-500 text-sm mt-0.5">Ethereum Sepolia · chainId 11155111</p>
        </div>
        <div className="flex items-center gap-4 pt-1">
          {lastUpdated && (
            <span className="text-gray-600 text-xs hidden sm:block">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <span
            className={`flex items-center gap-1.5 text-sm font-medium ${
              isOnline ? 'text-green-400' : 'text-red-400'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'
              }`}
            />
            {isOnline ? 'ONLINE' : loading ? 'LOADING' : 'ERROR'}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 bg-red-950/50 border border-red-900 text-red-300 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Skeleton */}
      {loading && !data && (
        <div className="flex items-center justify-center py-32 text-gray-600 text-sm">
          Fetching status...
        </div>
      )}

      {data && (
        <>
          {/* Portfolio strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'ETH Price', value: ethPrice ? usd(ethPrice) : '—' },
              { label: 'ETH Balance', value: `${fmt(data.portfolio.eth_balance, 4)} ETH` },
              { label: 'USDC Balance', value: usd(data.portfolio.usdc_balance) },
              { label: 'Total Value', value: usd(data.portfolio.total_value_usd) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className="text-lg font-semibold text-white tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* Open positions + price ticks */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Card title="Open Positions">
              {data.openTrades.length === 0 ? (
                <p className="text-gray-600 text-sm">No open positions.</p>
              ) : (
                <div className="space-y-3">
                  {data.openTrades.map((t) => {
                    const changePct =
                      ethPrice && t.entry_price
                        ? ((ethPrice - t.entry_price) / t.entry_price) * 100
                        : null;
                    const unrealizedPnl =
                      ethPrice && t.status === 'open'
                        ? (ethPrice - t.entry_price) * t.amount_eth
                        : null;

                    return (
                      <div
                        key={t.id}
                        className="bg-gray-800/60 rounded-lg p-4 border border-gray-700"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-semibold text-white">WETH</span>
                          <StatusPill status={t.status} />
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                          <span className="text-gray-500">Size</span>
                          <span className="text-white tabular-nums">{fmt(t.amount_eth, 4)} ETH</span>
                          <span className="text-gray-500">Entry price</span>
                          <span className="text-white tabular-nums">{usd(t.entry_price)}</span>
                          <span className="text-gray-500">Confidence</span>
                          <span className="text-white">{Math.round(t.confidence * 100)}%</span>
                          {unrealizedPnl !== null && (
                            <>
                              <span className="text-gray-500">Unrealized P&L</span>
                              <span className="tabular-nums">
                                <PnlCell pnl={unrealizedPnl} />
                                {changePct !== null && (
                                  <span
                                    className={`ml-1 text-xs ${
                                      changePct > 0 ? 'text-green-400' : 'text-red-400'
                                    }`}
                                  >
                                    ({changePct > 0 ? '+' : ''}
                                    {fmt(changePct, 1)}%)
                                  </span>
                                )}
                              </span>
                            </>
                          )}
                        </div>
                        {t.llm_reasoning && (
                          <p className="mt-3 text-xs text-gray-500 italic border-t border-gray-700 pt-2">
                            {t.llm_reasoning}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Recent Price Ticks (ETH/USD)">
              {data.recentPrices.length === 0 ? (
                <p className="text-gray-600 text-sm">
                  No observations yet — waiting for Kwala price updates.
                </p>
              ) : (
                <div className="space-y-1">
                  {data.recentPrices.slice(0, 12).map((p, i) => {
                    const { symbol, color } = priceTrend(data.recentPrices, i);
                    return (
                      <div key={i} className="flex items-center justify-between">
                        <span
                          className={`font-mono tabular-nums ${
                            i === 0 ? 'text-white text-base font-semibold' : 'text-gray-400 text-sm'
                          }`}
                        >
                          {usd(p)}
                        </span>
                        <span className={`text-sm ${color}`}>{symbol}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* LLM reasoning */}
          <div className="mb-4">
            <Card title="LLM Reasoning History">
              {data.recentReasoning.length === 0 ? (
                <p className="text-gray-600 text-sm">No reasoning recorded yet.</p>
              ) : (
                <ol className="space-y-2">
                  {data.recentReasoning.map((r, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="text-gray-700 font-mono shrink-0 mt-0.5 w-4 text-right">
                        {i + 1}
                      </span>
                      <span className="text-gray-300">{r}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          {/* Trades table */}
          <Card title={`Recent Trades (${data.recentTrades.length})`}>
            {data.recentTrades.length === 0 ? (
              <p className="text-gray-600 text-sm">No trades yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm min-w-[680px]">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['ID', 'Action', 'Size (ETH)', 'Entry', 'Exit', 'P&L', 'Confidence', 'Status', 'Time'].map(
                        (h) => (
                          <th
                            key={h}
                            className="pb-2.5 text-left text-xs text-gray-500 font-medium pr-4 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.recentTrades].reverse().map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors"
                      >
                        <td className="py-2.5 pr-4 text-gray-500 font-mono text-xs">{t.id}</td>
                        <td className="py-2.5 pr-4">
                          <ActionBadge action={t.action} />
                        </td>
                        <td className="py-2.5 pr-4 text-gray-300 font-mono tabular-nums">
                          {fmt(t.amount_eth, 4)}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-300 font-mono tabular-nums">
                          {usd(t.entry_price)}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-300 font-mono tabular-nums">
                          {t.exit_price ? usd(t.exit_price) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums">
                          <PnlCell pnl={t.pnl_usd} />
                        </td>
                        <td className="py-2.5 pr-4 text-gray-400 tabular-nums">
                          {Math.round(t.confidence * 100)}%
                        </td>
                        <td className="py-2.5 pr-4">
                          <StatusPill status={t.status} />
                        </td>
                        <td className="py-2.5 pr-4 text-gray-600 text-xs whitespace-nowrap">
                          {new Date(t.timestamp * 1000).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
