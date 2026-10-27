import { useEffect, useState } from 'react'
import {
  formatBytes,
  getStorageReport,
  type StorageReport,
} from '../lib/storageReport'

function describeYears(years: number | null): string | null {
  if (years === null) return null
  if (years >= 100) return '按当前记录速度，容量可用 100 年以上'
  if (years >= 10) return `按当前记录速度，容量还可用约 ${Math.floor(years)} 年`
  return `按当前记录速度，容量还可用约 ${years.toFixed(1)} 年`
}

/**
 * Shows the ledger's on-device footprint and a rough growth projection. The
 * numbers come from the same in-memory cache the app reads, so they reflect
 * what is actually persisted rather than a separate estimate.
 */
export function StorageUsageSection() {
  const [report, setReport] = useState<StorageReport | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void getStorageReport()
      .then((next) => {
        if (alive) setReport(next)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  if (failed) return null

  return (
    <div className="storage-usage" aria-live="polite">
      <div className="storage-usage-head">
        <span>本地占用</span>
        <strong>{report ? formatBytes(report.totalBytes) : '统计中…'}</strong>
      </div>
      {report ? (
        <>
          <ul className="storage-usage-list">
            {report.entries.map((entry) => (
              <li key={entry.key}>
                <span>
                  {entry.label}
                  {entry.count !== undefined
                    ? ` · ${entry.count} ${entry.unit ?? ''}`
                    : ''}
                </span>
                <span>{formatBytes(entry.bytes)}</span>
              </li>
            ))}
          </ul>
          <p className="storage-usage-note">
            存储方式：
            {report.backend === 'indexeddb'
              ? 'IndexedDB（不再受 5 MB 限制）'
              : 'localStorage（上限约 5 MB）'}
            {report.quotaBytes !== null
              ? ` · 可用上限 ${formatBytes(report.quotaBytes)}`
              : ''}
          </p>
          {report.bytesPerYear !== null ? (
            <p className="storage-usage-note">
              按最近 {Math.max(1, report.sampleDays)} 天的记录速度，每年约增加{' '}
              {formatBytes(report.bytesPerYear)}
              {describeYears(report.yearsLeft)
                ? `；${describeYears(report.yearsLeft)}`
                : ''}
              。
            </p>
          ) : (
            <p className="storage-usage-note">
              记录满 20 笔、跨越一周后会在这里估算长期容量。
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}
