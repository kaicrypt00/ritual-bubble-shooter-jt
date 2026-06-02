import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Entry = { username: string; score: number };

export function Leaderboard({ highlight }: { highlight?: string }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const client = supabase as any;
      const { data } = await client
        .from("leaderboard")
        .select("username,score")
        .gt("score", 0)
        .order("score", { ascending: false })
        .limit(20);
      if (alive) {
        setRows(data ?? []);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="w-full">
      {loading ? (
        <div className="text-[#BF00FF]/60 font-mono text-sm py-8 text-center">
          loading...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-[#BF00FF]/60 font-mono text-sm py-8 text-center">
          no scores yet — be the first
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <LeaderTable rows={rows.slice(0, 10)} startIdx={0} highlight={highlight} />
          <LeaderTable rows={rows.slice(10, 20)} startIdx={10} highlight={highlight} />
        </div>
      )}
    </div>
  );
}

function LeaderTable({
  rows,
  startIdx,
  highlight,
}: {
  rows: Entry[];
  startIdx: number;
  highlight?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-[#BF00FF]/40 font-mono text-xs py-6 text-center border border-[#BF00FF]/15 rounded">
        — empty —
      </div>
    );
  }
  return (
    <table className="w-full font-mono text-xs">
      <thead>
        <tr className="text-[#BF00FF]" style={{ textShadow: "0 0 6px #BF00FF" }}>
          <th className="py-2 border-b border-[#BF00FF]/30 text-center">RANK</th>
          <th className="py-2 border-b border-[#BF00FF]/30 text-center">PLAYER</th>
          <th className="py-2 border-b border-[#BF00FF]/30 text-center">SCORE</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const rank = startIdx + i + 1;
          const isMe = highlight && r.username === highlight;
          return (
            <tr
              key={r.username}
              className={`border-b border-[#BF00FF]/10 hover:bg-[rgba(191,0,255,0.05)] ${
                isMe ? "bg-[rgba(191,0,255,0.12)]" : ""
              }`}
            >
              <td className="py-1.5 text-center text-[#BF00FF]">#{rank}</td>
              <td className="py-1.5 text-center truncate max-w-[140px]">{r.username}</td>
              <td className="py-1.5 text-center tabular-nums">{r.score.toLocaleString()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
