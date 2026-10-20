import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { KNOWLEDGE_CATEGORIES, KnowledgeSchema, type KnowledgeInput } from '@wa/shared';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Panel,
  Select,
  TagInput,
  Textarea,
  Toggle,
  useToast,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useDebounced } from '../hooks/useDebounced';
import { api, ApiError, errorMessage } from '../lib/api';
import type { KnowledgeEntry } from '../lib/types';
import { timeAgo } from '../lib/utils';

const CATEGORY_LABEL: Record<string, string> = {
  FAQ: 'FAQ',
  POLICY: 'Policy',
  PRODUCT: 'Product',
  SERVICE: 'Service',
  CONTACT: 'Contact',
  OTHER: 'Other',
};
const EMPTY: KnowledgeInput = { category: 'FAQ', title: '', content: '', keywords: [], isActive: true };

function Editor({ entry, onClose }: { entry: KnowledgeEntry | 'new'; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<KnowledgeInput>(
    entry === 'new'
      ? EMPTY
      : {
          category: entry.category,
          title: entry.title,
          content: entry.content,
          keywords: entry.keywords,
          isActive: entry.isActive,
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: KnowledgeInput) =>
      entry === 'new' ? api.post('/knowledge', body) : api.put(`/knowledge/${entry.id}`, body),
    onSuccess: () => {
      toast(entry === 'new' ? 'Entry added' : 'Entry saved');
      qc.invalidateQueries({ queryKey: ['knowledge'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast(errorMessage(e), 'error');
    },
  });
  const submit = () => {
    const r = KnowledgeSchema.safeParse(v);
    if (!r.success)
      return setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    save.mutate(r.data);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={entry === 'new' ? 'New knowledge entry' : 'Edit knowledge entry'}
      width="max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-[160px_1fr] gap-3">
          <Field label="Category" htmlFor="k-cat">
            <Select
              id="k-cat"
              value={v.category}
              onChange={(e) => setV({ ...v, category: e.target.value as KnowledgeInput['category'] })}
            >
              {KNOWLEDGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor="k-title" error={errors.title}>
            <Input id="k-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          </Field>
        </div>
        <Field
          label="Content"
          htmlFor="k-content"
          error={errors.content}
          counter={{ value: v.content.length, max: 5000 }}
        >
          <Textarea
            id="k-content"
            rows={6}
            value={v.content}
            onChange={(e) => setV({ ...v, content: e.target.value })}
          />
        </Field>
        <Field
          label="Keywords"
          hint="Words customers use for this topic. They improve matching."
          htmlFor="k-kw"
          error={errors.keywords}
        >
          <TagInput
            id="k-kw"
            value={v.keywords ?? []}
            onChange={(k) => setV({ ...v, keywords: k })}
            placeholder="Type and press Enter"
          />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <Toggle
            label="Active"
            checked={v.isActive ?? true}
            onChange={(on) => setV({ ...v, isActive: on })}
          />{' '}
          Active (used by the assistant)
        </label>
      </div>
    </Modal>
  );
}

export function KnowledgePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<KnowledgeEntry | 'new' | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeEntry | null>(null);
  const s = useDebounced(search, 250);
  const params = new URLSearchParams({
    ...(s ? { search: s } : {}),
    ...(category ? { category } : {}),
  }).toString();
  const q = useQuery({
    queryKey: ['knowledge', params],
    queryFn: () => api.get<KnowledgeEntry[]>(`/knowledge${params ? `?${params}` : ''}`),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge/${id}`),
    onSuccess: () => {
      toast('Entry deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div>
      <PageHeader
        title="Knowledge base"
        description="FAQs, policies and product facts the assistant answers from. It does not make up answers that aren’t here."
        actions={
          can('ADMIN') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add entry
            </Button>
          )
        }
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap gap-2">
          <div className="relative w-[280px]">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-ink-3" />
            <Input
              aria-label="Search knowledge"
              placeholder="Search titles, content, keywords"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            aria-label="Category filter"
            className="w-[160px]"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>
        {q.isLoading && <LoadingBlock />}
        {q.error && <ErrorBlock error={q.error} />}
        {q.data && !q.data.length && (
          <Panel>
            <EmptyState
              icon={<BookOpen className="size-4" />}
              title={s || category ? 'No matching entries' : 'No knowledge yet'}
            >
              Add your FAQs and policies so the assistant can answer accurately.
            </EmptyState>
          </Panel>
        )}
        {!!q.data?.length && (
          <Panel>
            <ul className="divide-y divide-line">
              {q.data.map((k) => (
                <li key={k.id} className="flex items-start gap-3 px-4 py-3">
                  <Badge className="mt-0.5 w-[64px] justify-center">{CATEGORY_LABEL[k.category]}</Badge>
                  <button
                    type="button"
                    disabled={!can('ADMIN')}
                    onClick={() => setEditing(k)}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    <p className="text-[13.5px] font-medium">
                      {k.title} {!k.isActive && <Badge className="ml-1.5">Inactive</Badge>}
                    </p>
                    <p className="line-clamp-2 text-[12.5px] text-ink-3">{k.content}</p>
                    {!!k.keywords.length && (
                      <p className="mt-1 text-[11.5px] text-ink-3">{k.keywords.join(' · ')}</p>
                    )}
                  </button>
                  <span className="shrink-0 text-[12px] text-ink-3">{timeAgo(k.updatedAt)}</span>
                  {can('ADMIN') && (
                    <IconButton label={`Delete ${k.title}`} onClick={() => setDeleting(k)}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      {editing && <Editor entry={editing} onClose={() => setEditing(null)} />}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete entry?"
        description={`“${deleting?.title}” will no longer be used by the assistant.`}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={del.isPending}
              onClick={() => deleting && del.mutate(deleting.id)}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">This cannot be undone.</p>
      </Modal>
    </div>
  );
}
