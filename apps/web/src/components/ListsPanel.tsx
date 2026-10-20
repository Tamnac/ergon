import type { List } from '@ergon/core';
import { For, Show, createSignal } from 'solid-js';
import { isPhone } from '../lib/viewport';
import {
  addGroup,
  addList,
  deleteGroup,
  deleteList,
  moveGroup,
  moveList,
  moveListToGroup,
  renameGroup,
  renameList,
} from '../state/actions';
import { groups, lists, todosByList } from '../state/data';
import { activeGroup, panelOpen, setActiveGroupId, setPanelOpen } from '../state/view';
import { Cap } from './Cap';
import { Column } from './Column';
import { Icon, IconButton } from './Icon';
import { InlineInput } from './InlineInput';
import { Menu } from './Menu';
import './ListsPanel.css';

const listsIn = (groupId: string) => lists.filter((l) => l.groupId === groupId);

export function ListsPanel() {
  const [addingList, setAddingList] = createSignal(false);

  return (
    <div class="lists-drawer" classList={{ 'is-collapsed': !panelOpen() && !isPhone() }}>
      <div class="lists-drawer-content">
        <Show when={activeGroup()}>
          {(group) => (
            <section class="lists" aria-label="Lists">
              <For each={listsIn(group().id)}>{(list) => <ListColumn list={list} />}</For>
              <Show
                when={addingList()}
                fallback={
                  <button type="button" class="list-new" onClick={() => setAddingList(true)}>
                    <Icon name="plus" />
                    New list
                  </button>
                }
              >
                <div class="list-new is-adding">
                  <InlineInput
                    class="list-name-input"
                    label="New list name"
                    placeholder="List name"
                    onCommit={(name) => {
                      if (name.trim()) void addList(group().id, name.trim());
                      setAddingList(false);
                    }}
                    onCancel={() => setAddingList(false)}
                  />
                </div>
              </Show>
            </section>
          )}
        </Show>
      </div>
    </div>
  );
}

/** Tabs of list groups, with the tab menu and panel toggle at the end. */
export function TabBar() {
  const [renamingGroup, setRenamingGroup] = createSignal<string | null>(null);
  const [addingGroup, setAddingGroup] = createSignal(false);

  return (
    <nav class="tabs" aria-label="List tabs">
      <div class="tab-list" role="tablist" aria-label="Tabs">
        <For each={groups}>
          {(group) => (
            <Show
              when={renamingGroup() === group.id}
              fallback={
                <button
                  type="button"
                  role="tab"
                  class="tab"
                  aria-selected={group.id === activeGroup()?.id}
                  onClick={() => setActiveGroupId(group.id)}
                  onDblClick={() => setRenamingGroup(group.id)}
                >
                  {group.name}
                  <span class="tab-count">{listsIn(group.id).length}</span>
                </button>
              }
            >
              <InlineInput
                class="tab-input"
                label="Tab name"
                value={group.name}
                onCommit={(name) => {
                  if (name.trim()) void renameGroup(group, name.trim());
                  setRenamingGroup(null);
                }}
                onCancel={() => setRenamingGroup(null)}
              />
            </Show>
          )}
        </For>
      </div>
      <Show
        when={addingGroup()}
        fallback={<IconButton icon="plus" label="Add tab" onClick={() => setAddingGroup(true)} />}
      >
        <InlineInput
          class="tab-input"
          label="New tab name"
          onCommit={(name) => {
            setAddingGroup(false);
            if (name.trim()) void addGroup(name.trim()).then(setActiveGroupId);
          }}
          onCancel={() => setAddingGroup(false)}
        />
      </Show>
      <div class="tabs-end">
        <Show when={activeGroup()}>
          {(group) => (
            <Menu
              label="Tab actions"
              items={[
                { label: 'Rename tab', onSelect: () => setRenamingGroup(group().id) },
                { label: 'Move left', onSelect: () => void moveGroup(group(), -1) },
                { label: 'Move right', onSelect: () => void moveGroup(group(), 1) },
                {
                  label: 'Delete tab',
                  onSelect: () => void deleteGroup(group()),
                  disabled: groups.length < 2,
                },
              ]}
            />
          )}
        </Show>
        <Show when={!isPhone()}>
          <IconButton
            icon={panelOpen() ? 'chevron-down' : 'chevron-up'}
            label={panelOpen() ? 'Hide lists' : 'Show lists'}
            onClick={() => setPanelOpen(!panelOpen())}
          />
        </Show>
      </div>
    </nav>
  );
}

function ListColumn(props: { list: List }) {
  const [renaming, setRenaming] = createSignal(false);

  const header = (
    <header class="list-header">
      <Show
        when={renaming()}
        fallback={
          <h2 class="list-name" onClick={() => setRenaming(true)}>
            <Cap text={props.list.name} />
          </h2>
        }
      >
        <InlineInput
          class="list-name-input"
          label="List name"
          value={props.list.name}
          onCommit={(name) => {
            if (name.trim()) void renameList(props.list, name.trim());
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      </Show>
      <Menu
        label="List actions"
        class="list-menu"
        items={[
          { label: 'Rename', onSelect: () => setRenaming(true) },
          { label: 'Move left', onSelect: () => void moveList(props.list, -1) },
          { label: 'Move right', onSelect: () => void moveList(props.list, 1) },
          ...groups
            .filter((g) => g.id !== props.list.groupId)
            .map((g) => ({
              label: `Move to ${g.name}`,
              onSelect: () => void moveListToGroup(props.list, g.id),
            })),
          { label: 'Delete list', onSelect: () => void deleteList(props.list) },
        ]}
      />
    </header>
  );

  return (
    <Column
      class="list-column"
      target={{ listId: props.list.id }}
      items={todosByList().get(props.list.id) ?? []}
      header={header}
      label={props.list.name}
    />
  );
}
