'use client';

import { VETTING_STEP_LABELS, VettingQueueItem } from '@driva/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useUnauthorizedRedirect } from '../Shell';

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-NG', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Lagos',
      })
    : '';

export default function VettingQueue() {
  const onAuthError = useUnauthorizedRedirect();
  const [queue, setQueue] = useState<VettingQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .vettingQueue()
      .then(setQueue)
      .catch((err) => {
        onAuthError(err);
        setError(errorText(err));
      });
  }, []);

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 28 }}>Vetting queue</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Drivers waiting on VeriQuest, oldest application first.
          </p>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="card table-scroll">
        {queue === null ? (
          <p className="muted">Loading…</p>
        ) : queue.length === 0 ? (
          <p className="muted">
            No drivers are waiting. New applications appear here when drivers submit them.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>City</th>
                <th>Submitted</th>
                <th>Progress</th>
                <th>Next step</th>
                <th>Officer</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={item.driverId}>
                  <td>
                    <Link href={`/vetting/${item.driverId}`} style={{ fontWeight: 700 }}>
                      {item.fullName}
                    </Link>
                  </td>
                  <td>{item.city}</td>
                  <td className="small">{date(item.submittedAt)}</td>
                  <td>
                    {item.passed} of {item.total}
                  </td>
                  <td>
                    {item.nextStep ? (
                      <>
                        {VETTING_STEP_LABELS[item.nextStep]}{' '}
                        <span className={`badge ${item.nextStepStatus}`}>
                          {item.nextStepStatus?.replace('_', ' ')}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td className="small">
                    {item.officerName ?? <span className="muted">Not assigned</span>}
                    {item.scheduledFor ? (
                      <div className="muted">{date(item.scheduledFor)}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
