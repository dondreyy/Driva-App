'use client';

import {
  AdminDriverView,
  DRIVER_DOCUMENT_LABELS,
  FIELD_VISIT_STEPS,
  formatNigerianPhone,
  StaffMember,
  VETTING_STEP_LABELS,
  VettingCheckView,
} from '@driva/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useMe, useUnauthorizedRedirect } from '../../Shell';

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-NG', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Lagos',
      })
    : '';

const CONSENT_LABELS: Record<string, string> = {
  home_visit: 'Home visit',
  guarantor_visits: 'Guarantor visits',
  id_and_criminal_checks: 'ID and criminal record checks',
};

export default function DriverReview() {
  const { driverId } = useParams<{ driverId: string }>();
  const onAuthError = useUnauthorizedRedirect();
  const [driver, setDriver] = useState<AdminDriverView | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .adminDriver(driverId)
      .then(setDriver)
      .catch((err) => {
        onAuthError(err);
        setError(errorText(err));
      });
    // Reload only when the driver changes.
  }, [driverId]);

  useEffect(() => {
    load();
    api
      .staff()
      .then(setStaff)
      .catch(() => undefined);
  }, [load]);

  if (!driver)
    return error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>;

  const open = driver.status === 'in_vetting';
  return (
    <>
      <p className="small">
        <Link href="/vetting">← Vetting queue</Link>
      </p>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 28 }}>{driver.fullName}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {driver.city} · applied {date(driver.submittedAt)}
          </p>
        </div>
        <span className={`badge ${driver.status}`} style={{ fontSize: 14 }}>
          {driver.status.replace('_', ' ')}
        </span>
      </div>
      {error ? <div className="error">{error}</div> : null}

      <div className="grid two">
        <section className="card">
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Driver</h2>
          <dl>
            <dt>Phone</dt>
            <dd>{formatNigerianPhone(driver.phone)}</dd>
            <dt>NIN</dt>
            <dd>
              <Sensitive driverId={driver.id} field="nin" masked={driver.ninMasked} />
            </dd>
            <dt>Licence</dt>
            <dd>
              <Sensitive driverId={driver.id} field="licenceNumber" masked={driver.licenceMasked} />
            </dd>
            <dt>Driving</dt>
            <dd>{driver.yearsDriving}</dd>
            <dt>Home</dt>
            <dd>{driver.homeAddress}</dd>
            <dt>Consent</dt>
            <dd>
              {driver.consents.map((c) => (
                <div key={c.kind} className="small">
                  {CONSENT_LABELS[c.kind] ?? c.kind} · {date(c.acceptedAt)}
                </div>
              ))}
            </dd>
          </dl>
        </section>

        <section className="card">
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Guarantors</h2>
          {driver.guarantors.map((g) => (
            <div key={g.slot} style={{ marginBottom: 12 }}>
              <b>
                {g.slot}. {g.fullName}
              </b>
              <div className="small">{formatNigerianPhone(g.phone)}</div>
              <div className="small muted">{g.relationship}</div>
              <div className="small">{g.address}</div>
            </div>
          ))}
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Documents</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Links expire after 5 minutes. Reload the page to see them again.
        </p>
        <div className="docs">
          {driver.documents.map((doc) => (
            <figure key={doc.kind}>
              <a href={doc.url} target="_blank" rel="noreferrer">
                {/* Signed, short lived URL from private storage. */}
                <img src={doc.url} alt={DRIVER_DOCUMENT_LABELS[doc.kind]} />
              </a>
              <figcaption>{DRIVER_DOCUMENT_LABELS[doc.kind]}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 18 }}>Checks</h2>
        {driver.checks.map((check) => (
          <Check
            key={check.id}
            check={check}
            open={open}
            staff={staff}
            onDone={setDriver}
            onError={setError}
          />
        ))}
      </section>

      {open ? <Approve driver={driver} onDone={setDriver} /> : null}
    </>
  );
}

function Sensitive({
  driverId,
  field,
  masked,
}: {
  driverId: string;
  field: 'nin' | 'licenceNumber';
  masked: string | null;
}) {
  const [value, setValue] = useState<string | null>(null);
  if (!masked) return null;
  return (
    <span>
      <code>{value ?? masked}</code>{' '}
      {value ? null : (
        <button
          className="link"
          title="Each view is recorded in the audit log"
          onClick={() => api.reveal(driverId, { field }).then((r) => setValue(r.value))}
        >
          Show
        </button>
      )}
    </span>
  );
}

function Check({
  check,
  open,
  staff,
  onDone,
  onError,
}: {
  check: VettingCheckView;
  open: boolean;
  staff: StaffMember[];
  onDone: (driver: AdminDriverView) => void;
  onError: (message: string | null) => void;
}) {
  const me = useMe();
  const [mode, setMode] = useState<'none' | 'assign' | 'result'>('none');
  const finished = check.status === 'passed' || check.status === 'failed';
  const canAct = open && !finished && check.step !== 'final_review';

  return (
    <div className="check">
      <div className="row">
        <div>
          <b>{VETTING_STEP_LABELS[check.step]}</b>{' '}
          <span className={`badge ${check.status}`}>{check.status.replace('_', ' ')}</span>
          <div className="small muted">
            {check.officerName ? `Officer: ${check.officerName}` : 'Not assigned'}
            {check.scheduledFor ? ` · visit ${date(check.scheduledFor)}` : ''}
            {check.completedAt ? ` · done ${date(check.completedAt)}` : ''}
          </div>
          {check.resultNote ? <div className="small">Note: {check.resultNote}</div> : null}
          {check.visitLocation ? (
            <div className="small muted">
              GPS {check.visitLocation.lat.toFixed(5)}, {check.visitLocation.lng.toFixed(5)}
            </div>
          ) : null}
          {check.evidence.length ? (
            <div className="small">
              {check.evidence.map((e, i) => (
                <a
                  key={e.key}
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginRight: 8 }}
                >
                  Evidence photo {i + 1}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        {canAct ? (
          <div className="row">
            <button
              className="btn ghost"
              onClick={() => setMode(mode === 'assign' ? 'none' : 'assign')}
            >
              Assign
            </button>
            <button
              className="btn dark"
              onClick={() => setMode(mode === 'result' ? 'none' : 'result')}
            >
              Record result
            </button>
          </div>
        ) : null}
      </div>
      {canAct && mode === 'assign' ? (
        <AssignForm
          check={check}
          staff={staff}
          defaultOfficer={me?.id}
          onDone={() => setMode('none')}
          onError={onError}
          onSaved={onDone}
        />
      ) : null}
      {canAct && mode === 'result' ? (
        <ResultForm
          check={check}
          onSaved={(d) => {
            setMode('none');
            onDone(d);
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function AssignForm({
  check,
  staff,
  defaultOfficer,
  onDone,
  onError,
  onSaved,
}: {
  check: VettingCheckView;
  staff: StaffMember[];
  defaultOfficer?: string;
  onDone: () => void;
  onError: (message: string | null) => void;
  onSaved: (driver: AdminDriverView) => void;
}) {
  const { driverId } = useParams<{ driverId: string }>();
  const [officerId, setOfficerId] = useState(check.officerId ?? defaultOfficer ?? '');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    onError(null);
    setBusy(true);
    try {
      await api.assignCheck(check.id, {
        officerId,
        // datetime-local has no zone; Lagos is UTC+1 all year.
        ...(when ? { scheduledFor: `${when}:00+01:00` } : {}),
      });
      onSaved(await api.adminDriver(driverId));
      onDone();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="grid two">
        <div className="field">
          <label htmlFor={`officer-${check.id}`}>Officer</label>
          <select
            id={`officer-${check.id}`}
            value={officerId}
            onChange={(e) => setOfficerId(e.target.value)}
            required
          >
            <option value="">Choose…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`when-${check.id}`}>Visit time (Lagos), optional</label>
          <input
            id={`when-${check.id}`}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
      </div>
      <button className="btn" type="submit" disabled={busy || !officerId}>
        Save assignment
      </button>
    </form>
  );
}

function ResultForm({
  check,
  onSaved,
  onError,
}: {
  check: VettingCheckView;
  onSaved: (driver: AdminDriverView) => void;
  onError: (message: string | null) => void;
}) {
  const isVisit = FIELD_VISIT_STEPS.includes(check.step);
  const [status, setStatus] = useState<'passed' | 'failed'>('passed');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);

  function locate() {
    onError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        onError('Could not get your location. Allow location access and try again at the address.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    onError(null);
    setBusy(true);
    try {
      const evidenceKeys: string[] = [];
      for (const file of files) {
        const contentType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const ticket = await api.evidenceUpload(check.id, { contentType });
        const put = await fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body: file });
        if (!put.ok) throw new Error(`${file.name} did not upload`);
        evidenceKeys.push(ticket.key);
      }
      onSaved(
        await api.recordResult(check.id, {
          status,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(evidenceKeys.length ? { evidenceKeys } : {}),
          ...(location ? { visitLocation: location } : {}),
        }),
      );
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const visitReady = !isVisit || status === 'failed' || (files.length > 0 && location);
  return (
    <form className="panel" onSubmit={submit}>
      <div className="choices" role="radiogroup" aria-label="Result">
        <label>
          <input
            type="radio"
            name={`r-${check.id}`}
            checked={status === 'passed'}
            onChange={() => setStatus('passed')}
          />{' '}
          Passed
        </label>
        <label>
          <input
            type="radio"
            name={`r-${check.id}`}
            checked={status === 'failed'}
            onChange={() => setStatus('failed')}
          />{' '}
          Failed
        </label>
      </div>
      {isVisit ? (
        <>
          <div className="field">
            <label htmlFor={`files-${check.id}`}>
              Photos from the visit {status === 'passed' ? '(required)' : ''}
            </label>
            <input
              id={`files-${check.id}`}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </div>
          <div className="field">
            <label>Visit location {status === 'passed' ? '(required)' : ''}</label>
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="btn ghost" onClick={locate} disabled={locating}>
                {location
                  ? 'Location recorded ✓'
                  : locating
                    ? 'Finding you…'
                    : 'Use my location now'}
              </button>
              {location ? (
                <span className="small muted">
                  {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                </span>
              ) : (
                <span className="small muted">Press this at the address.</span>
              )}
            </div>
          </div>
        </>
      ) : null}
      <div className="field">
        <label htmlFor={`note-${check.id}`}>
          Note {status === 'failed' ? '(required: the reason)' : '(optional)'}
        </label>
        <textarea
          id={`note-${check.id}`}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <button
        className={status === 'failed' ? 'btn danger' : 'btn'}
        type="submit"
        disabled={busy || !visitReady || (status === 'failed' && note.trim().length < 5)}
      >
        {status === 'failed' ? 'Fail check and reject driver' : 'Mark as passed'}
      </button>
    </form>
  );
}

function Approve({
  driver,
  onDone,
}: {
  driver: AdminDriverView;
  onDone: (d: AdminDriverView) => void;
}) {
  const me = useMe();
  const [note, setNote] = useState('');
  const [waive, setWaive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = driver.checks.filter((c) => c.step !== 'final_review' && c.status !== 'passed');

  async function approve() {
    setError(null);
    setBusy(true);
    try {
      onDone(
        await api.approveDriver(driver.id, {
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(me?.role === 'admin' ? { vettingFeeWaived: waive } : {}),
        }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 18 }}>Final review</h2>
      {waiting.length ? (
        <p className="muted">
          Waiting on: {waiting.map((c) => VETTING_STEP_LABELS[c.step]).join(', ')}. Approval opens
          when these pass.
        </p>
      ) : (
        <p className="muted">
          Every check has passed. Approving lets {driver.fullName.split(' ')[0]} go online.
        </p>
      )}
      {error ? <div className="error">{error}</div> : null}
      <div className="field">
        <label htmlFor="approve-note">Note (optional)</label>
        <textarea
          id="approve-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {me?.role === 'admin' ? (
        <div className="choices">
          <label>
            <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />{' '}
            Founding driver: vetting is free
          </label>
        </div>
      ) : null}
      <button className="btn" onClick={() => void approve()} disabled={busy || waiting.length > 0}>
        Approve driver
      </button>
    </section>
  );
}
