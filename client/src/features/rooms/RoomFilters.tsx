import {
  LANGUAGE_IDS,
  LANGUAGES,
  listRoomsQuerySchema,
  MAX_ROOM_SEARCH_LENGTH,
  ROOM_ROLES,
  type ListRoomsQuery,
} from '@devverse/shared';
import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback';

type FilterChanges = Partial<Record<keyof ListRoomsQuery, string>>;

const SEARCH_DELAY_MS = 300;
const fields = listRoomsQuerySchema.shape;

export const hasFilters = (filters: ListRoomsQuery) =>
  Boolean(filters.q || filters.language || filters.role);

/**
 * The dashboard's search and filters, kept in the address bar.
 *
 * [CONCEPT: URL as State] /dashboard?q=pair&language=python can be bookmarked, shared or reloaded and shows the same
 * rooms. Changes replace the history entry, so Back still leaves the dashboard rather than undoing each keystroke.
 */
export function useRoomFilters() {
  const [params, setParams] = useSearchParams();
  // Each filter is checked on its own, so one the server wouldn't accept (?language=cobol) is ignored, not fatal.
  const filters: ListRoomsQuery = {
    q: fields.q.safeParse(params.get('q') ?? undefined).data,
    language: fields.language.safeParse(params.get('language') ?? undefined).data,
    role: fields.role.safeParse(params.get('role') ?? undefined).data,
  };
  const update = (changes: FilterChanges) =>
    setParams(
      (current) => {
        for (const [key, value] of Object.entries(changes)) {
          if (value) current.set(key, value);
          else current.delete(key);
        }
        return current;
      },
      { replace: true },
    );
  return { filters, update };
}

const roleLabels = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' } as const;
const controlClass = 'h-10.5 rounded-md border border-border bg-surface px-3';

interface RoomFiltersProps {
  filters: ListRoomsQuery;
  onChange: (changes: FilterChanges) => void;
}

export function RoomFilters({ filters, onChange }: RoomFiltersProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const urlQuery = filters.q ?? '';
  // The box updates on every keystroke; the URL (and so the search) only once typing pauses.
  const [text, setText] = useState(urlQuery);
  const search = useDebouncedCallback(
    (value: string) => onChange({ q: value.trim() }),
    SEARCH_DELAY_MS,
  );

  // If the URL's search changes from outside (a link back to /dashboard, Clear), show that instead. Checked while
  // rendering, as React recommends for adjusting state to a prop, rather than in an effect that renders twice.
  const [seenQuery, setSeenQuery] = useState(urlQuery);
  if (urlQuery !== seenQuery) {
    setSeenQuery(urlQuery);
    if (urlQuery !== text.trim()) setText(urlQuery);
  }

  function onSubmit(e: FormEvent) {
    // Enter searches straight away rather than waiting out the delay.
    e.preventDefault();
    search.cancel();
    onChange({ q: text.trim() });
  }

  function clear() {
    search.cancel();
    setText('');
    onChange({ q: '', language: '', role: '' });
    // The Clear button disappears, so put focus somewhere useful instead of losing it.
    searchRef.current?.focus();
  }

  return (
    <form
      role="search"
      aria-label="Your rooms"
      onSubmit={onSubmit}
      className="mb-4 flex flex-wrap items-end gap-3"
    >
      <div className="flex w-full flex-col gap-1 sm:w-auto sm:min-w-48 sm:flex-1">
        <label htmlFor="room-search" className="text-sm text-muted">
          Search
        </label>
        <input
          ref={searchRef}
          id="room-search"
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            search.call(e.target.value);
          }}
          maxLength={MAX_ROOM_SEARCH_LENGTH}
          placeholder="Room name"
          autoComplete="off"
          enterKeyHint="search"
          className={controlClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="room-language" className="text-sm text-muted">
          Language
        </label>
        <select
          id="room-language"
          value={filters.language ?? ''}
          onChange={(e) => onChange({ language: e.target.value })}
          className={controlClass}
        >
          <option value="">Any</option>
          {LANGUAGE_IDS.map((id) => (
            <option key={id} value={id}>
              {LANGUAGES[id].label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="room-role" className="text-sm text-muted">
          Your role
        </label>
        <select
          id="room-role"
          value={filters.role ?? ''}
          onChange={(e) => onChange({ role: e.target.value })}
          className={controlClass}
        >
          <option value="">Any</option>
          {[...ROOM_ROLES].reverse().map((role) => (
            <option key={role} value={role}>
              {roleLabels[role]}
            </option>
          ))}
        </select>
      </div>
      {(hasFilters(filters) || text.trim()) && (
        <button
          type="button"
          onClick={clear}
          className="h-10.5 rounded-md border border-border px-3 hover:bg-surface-2"
        >
          Clear filters
        </button>
      )}
    </form>
  );
}
