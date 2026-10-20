import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ListTree, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm, useWatch, type Control, type UseFormRegister } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MENU_ACTION_LABELS, MENU_ACTION_TYPES, MenuSchema, WA_LIMITS, type MenuInput } from '@wa/shared';
import { MenuBubble } from '../components/chat/ChatThread';
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
  PanelHeader,
  Select,
  Textarea,
  useToast,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Menu, Product, WorkflowSummary } from '../lib/types';
import { cn, timeAgo } from '../lib/utils';

const toForm = (m: Menu): MenuInput => ({
  name: m.name,
  header: m.header,
  body: m.body,
  buttonLabel: m.buttonLabel,
  isDefault: m.isDefault,
  options: m.options.map((o) => ({
    id: o.id,
    title: o.title,
    description: o.description,
    actionType: o.actionType,
    actionConfig: { ...o.actionConfig },
  })),
});

function OptionConfig({
  index,
  control,
  register,
  menus,
  workflows,
  categories,
  selfId,
  error,
}: {
  index: number;
  control: Control<MenuInput>;
  register: UseFormRegister<MenuInput>;
  menus: Menu[];
  workflows: WorkflowSummary[];
  categories: string[];
  selfId?: string;
  error?: string;
}) {
  const type = useWatch({ control, name: `options.${index}.actionType` });
  const p = `options.${index}.actionConfig` as const;
  switch (type) {
    case 'REPLY':
      return (
        <Field label="Reply text" error={error}>
          <Textarea aria-label="Reply text" rows={2} {...register(`${p}.text`)} />
        </Field>
      );
    case 'SUBMENU':
      return (
        <Field label="Menu to open" error={error}>
          <Select aria-label="Menu to open" {...register(`${p}.menuId`)}>
            <option value="">Choose a menu</option>
            {menus
              .filter((m) => m.id !== selfId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </Select>
        </Field>
      );
    case 'PRODUCT_LIST':
      return (
        <Field label="Category">
          <Select aria-label="Category" {...register(`${p}.category`)}>
            <option value="">All products</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'HANDOFF':
      return (
        <Field label="Note for the team (optional)">
          <Input aria-label="Handoff note" {...register(`${p}.note`)} />
        </Field>
      );
    case 'RUN_WORKFLOW':
      return (
        <Field label="Workflow" error={error} hint="The workflow runs even if it is not active.">
          <Select aria-label="Workflow" {...register(`${p}.workflowId`)}>
            <option value="">Choose a workflow</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'AI_ANSWER':
      return (
        <Field label="Prompt for the assistant (optional)" hint="Defaults to the option title.">
          <Input aria-label="Assistant prompt" {...register(`${p}.prompt`)} />
        </Field>
      );
    default:
      return null;
  }
}

function MenuEditor({ menu, menus }: { menu: Menu; menus: Menu[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const readOnly = !can('ADMIN');
  const workflows = useQuery({
    queryKey: ['workflows'],
    queryFn: () => api.get<WorkflowSummary[]>('/workflows'),
  });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products') });
  const categories = [...new Set((products.data ?? []).map((p) => p.category))];
  const [showPayload, setShowPayload] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const form = useForm<MenuInput>({
    resolver: zodResolver(MenuSchema) as never,
    defaultValues: toForm(menu),
    mode: 'onChange',
  });
  const { register, control, handleSubmit, reset, formState, setError } = form;
  const { fields, append, remove, move } = useFieldArray({ control, name: 'options', keyName: 'key' });
  useEffect(() => reset(toForm(menu)), [menu, reset]);
  const values = useWatch({ control }) as MenuInput;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['menus'] });
    qc.invalidateQueries({ queryKey: ['menu-preview', menu.id] });
  };
  const save = useMutation({
    mutationFn: (v: MenuInput) => api.put<Menu>(`/menus/${menu.id}`, v),
    onSuccess: (m) => {
      toast(m.isPublished ? 'Saved; customers see the change now' : 'Saved');
      reset(toForm(m));
      invalidate();
    },
    onError: (e) => {
      if (e instanceof ApiError)
        Object.entries(e.fieldErrors).forEach(([path, message]) => setError(path as 'name', { message }));
      toast(errorMessage(e), 'error');
    },
  });
  const publish = useMutation({
    mutationFn: (on: boolean) => api.post<Menu>(`/menus/${menu.id}/${on ? 'publish' : 'unpublish'}`),
    onSuccess: (m) => {
      toast(m.isPublished ? 'Menu published' : 'Menu unpublished');
      invalidate();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/menus/${menu.id}`),
    onSuccess: () => {
      toast('Menu deleted');
      qc.invalidateQueries({ queryKey: ['menus'] });
      navigate('/app/menus');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const preview = useQuery({
    queryKey: ['menu-preview', menu.id],
    queryFn: () => api.get<{ cloudPayload: unknown }>(`/menus/${menu.id}/preview`),
    enabled: showPayload,
  });

  const errs = formState.errors;
  const optionCount = values.options?.length ?? 0;
  const format = optionCount <= WA_LIMITS.replyButtonsMax ? 'reply buttons' : 'a list message';

  return (
    <form
      onSubmit={handleSubmit((v) => save.mutate(v))}
      noValidate
      className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className="space-y-4">
        <Panel>
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                {menu.name}
                {menu.isPublished ? (
                  <Badge tone="accent" dot>
                    Published
                  </Badge>
                ) : (
                  <Badge>Draft</Badge>
                )}
                {menu.isDefault && <Badge tone="info">Default</Badge>}
              </span>
            }
            description={`Updated ${timeAgo(menu.updatedAt)}`}
            actions={
              !readOnly && (
                <div className="flex gap-2">
                  <IconButton label="Delete menu" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                  <Button
                    size="sm"
                    onClick={() => publish.mutate(!menu.isPublished)}
                    loading={publish.isPending}
                    disabled={formState.isDirty}
                  >
                    {menu.isPublished ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    type="submit"
                    loading={save.isPending}
                    disabled={!formState.isDirty}
                  >
                    Save
                  </Button>
                </div>
              )
            }
          />
          <fieldset disabled={readOnly} className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Menu name" error={errs.name?.message} htmlFor="m-name">
              <Input id="m-name" {...register('name')} />
            </Field>
            <Field
              label="Header (optional)"
              htmlFor="m-header"
              error={errs.header?.message}
              counter={{ value: values.header?.length ?? 0, max: WA_LIMITS.headerMax }}
            >
              <Input id="m-header" {...register('header')} />
            </Field>
            <Field
              label="Message"
              className="sm:col-span-2"
              htmlFor="m-body"
              error={errs.body?.message}
              counter={{ value: values.body?.length ?? 0, max: WA_LIMITS.bodyMax }}
            >
              <Textarea id="m-body" rows={2} {...register('body')} />
            </Field>
            <Field
              label="List button label"
              htmlFor="m-btn"
              error={errs.buttonLabel?.message}
              hint="Shown when there are more than 3 options."
              counter={{ value: values.buttonLabel?.length ?? 0, max: WA_LIMITS.listButtonMax }}
            >
              <Input id="m-btn" {...register('buttonLabel')} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink-2">
              <input type="checkbox" {...register('isDefault')} className="accent-[var(--color-accent)]" />{' '}
              Default menu (sent when nothing else matches)
            </label>
          </fieldset>
        </Panel>

        <Panel>
          <PanelHeader
            title="Options"
            description={`${optionCount}/${WA_LIMITS.listRowsMax} · sent as ${format}`}
          />
          {errs.options?.message && (
            <p className="px-4 pt-3 text-[12.5px] text-danger">{errs.options.message}</p>
          )}
          <fieldset disabled={readOnly}>
            <ol className="divide-y divide-line">
              {fields.map((f, i) => {
                const oe = errs.options?.[i];
                const cfgErr = oe?.actionConfig as Record<string, { message?: string }> | undefined;
                return (
                  <li key={f.key} className="grid gap-3 p-4 sm:grid-cols-[24px_1fr]">
                    <span className="flex size-6 items-center justify-center rounded-full bg-subtle text-[12px] font-semibold text-ink-2 tabular">
                      {i + 1}
                    </span>
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Title"
                          error={oe?.title?.message}
                          counter={{
                            value: values.options?.[i]?.title?.length ?? 0,
                            max: optionCount <= 3 ? WA_LIMITS.replyButtonTitleMax : WA_LIMITS.listRowTitleMax,
                          }}
                        >
                          <Input aria-label={`Option ${i + 1} title`} {...register(`options.${i}.title`)} />
                        </Field>
                        <Field label="Action">
                          <Select
                            aria-label={`Option ${i + 1} action`}
                            {...register(`options.${i}.actionType`)}
                          >
                            {MENU_ACTION_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {MENU_ACTION_LABELS[t]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      {optionCount > 3 && (
                        <Field
                          label="Description (optional)"
                          error={oe?.description?.message}
                          counter={{
                            value: values.options?.[i]?.description?.length ?? 0,
                            max: WA_LIMITS.listRowDescriptionMax,
                          }}
                        >
                          <Input
                            aria-label={`Option ${i + 1} description`}
                            {...register(`options.${i}.description`)}
                          />
                        </Field>
                      )}
                      <OptionConfig
                        index={i}
                        control={control}
                        register={register}
                        menus={menus}
                        workflows={workflows.data ?? []}
                        categories={categories}
                        selfId={menu.id}
                        error={
                          cfgErr?.text?.message ?? cfgErr?.menuId?.message ?? cfgErr?.workflowId?.message
                        }
                      />
                      {!readOnly && (
                        <div className="flex gap-1">
                          <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                            <ArrowUp className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label="Move down"
                            disabled={i === fields.length - 1}
                            onClick={() => move(i, i + 1)}
                          >
                            <ArrowDown className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label="Remove option"
                            disabled={fields.length === 1}
                            onClick={() => remove(i)}
                          >
                            <X className="size-3.5" />
                          </IconButton>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {!readOnly && (
              <div className="border-t border-line p-3">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus className="size-3.5" />}
                  disabled={fields.length >= WA_LIMITS.listRowsMax}
                  onClick={() =>
                    append({ title: '', description: '', actionType: 'REPLY', actionConfig: { text: '' } })
                  }
                >
                  Add option
                </Button>
              </div>
            )}
          </fieldset>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelHeader
            title="WhatsApp preview"
            description={formState.isDirty ? 'Showing unsaved changes' : undefined}
          />
          <div className="bg-[#efeae2] p-4">
            <div className="max-w-[280px] rounded-lg rounded-tl-none bg-white px-2.5 pt-1.5 text-[13.5px] shadow-xs">
              <MenuBubble
                menu={{
                  header: values.header,
                  body: values.body || 'Message text',
                  buttonLabel: values.buttonLabel,
                  options: (values.options ?? []).map((o, i) => ({
                    id: o.id ?? String(i),
                    title: o.title || `Option ${i + 1}`,
                    description: optionCount > 3 ? o.description : undefined,
                  })),
                }}
                disabled
              />
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHeader
            title="Cloud API payload"
            description="Built from the last saved version."
            actions={
              <Button size="sm" variant="ghost" onClick={() => setShowPayload((v) => !v)}>
                {showPayload ? 'Hide' : 'Show'}
              </Button>
            }
          />
          {showPayload &&
            (preview.isLoading ? (
              <LoadingBlock rows={2} />
            ) : (
              <pre className="max-h-[360px] overflow-auto p-4 font-mono text-[11.5px] text-ink-2">
                {JSON.stringify(preview.data?.cloudPayload, null, 2)}
              </pre>
            ))}
        </Panel>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete menu?"
        description={`“${menu.name}” will be removed. Workflows or options that open it will stop working.`}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">This cannot be undone.</p>
      </Modal>
    </form>
  );
}

export function MenusPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['menus'], queryFn: () => api.get<Menu[]>('/menus') });
  const create = useMutation({
    mutationFn: () =>
      api.post<Menu>('/menus', {
        name: 'New menu',
        body: 'How can we help you today?',
        buttonLabel: 'View options',
        options: [{ title: 'Talk to support', actionType: 'HANDOFF', actionConfig: {} }],
      }),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['menus'] });
      navigate(`/app/menus/${m.id}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const selected = q.data?.find((m) => m.id === id) ?? (id ? undefined : q.data?.[0]);

  return (
    <div>
      <PageHeader
        title="Menus"
        description="Interactive WhatsApp menus. Up to 3 options are sent as reply buttons, more as a list (max 10)."
        actions={
          can('ADMIN') && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              New menu
            </Button>
          )
        }
      />
      <div className="grid gap-5 p-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Menus" className="space-y-1">
          {q.isLoading && <LoadingBlock rows={3} />}
          {q.data?.map((m) => (
            <Link
              key={m.id}
              to={`/app/menus/${m.id}`}
              className={cn(
                'flex items-center justify-between rounded-md px-3 py-2 text-[13.5px] hover:bg-subtle',
                selected?.id === m.id && 'bg-subtle font-medium',
              )}
            >
              <span className="truncate">{m.name}</span>
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  m.isPublished ? 'bg-accent' : 'bg-line-strong',
                )}
                title={m.isPublished ? 'Published' : 'Draft'}
              />
            </Link>
          ))}
        </nav>
        <div>
          {q.error && <ErrorBlock error={q.error} />}
          {q.data && !q.data.length && (
            <Panel>
              <EmptyState icon={<ListTree className="size-4" />} title="No menus yet">
                Menus give customers buttons to tap instead of typing.
              </EmptyState>
            </Panel>
          )}
          {q.data && id && !selected && (
            <Panel>
              <EmptyState title="Menu not found" />
            </Panel>
          )}
          {selected && <MenuEditor key={selected.id} menu={selected} menus={q.data ?? []} />}
        </div>
      </div>
    </div>
  );
}
