import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { deleteSession, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { TaskInfo } from '../../shared/protocol.ts';
import type { LiveManager } from './live.ts';

export function getTasksRoot(): string {
  return join(homedir(), '.ccwebui', 'tasks');
}

function getTasksFile(): string {
  return join(homedir(), '.ccwebui', 'tasks.json');
}

async function loadTasksRecord(): Promise<TaskInfo[]> {
  const file = getTasksFile();
  if (!existsSync(file)) return [];
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveTasksRecord(tasks: TaskInfo[]): Promise<void> {
  const file = getTasksFile();
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(tasks, null, 2), 'utf8');
  await rename(tmp, file);
}

export async function listTasks(): Promise<TaskInfo[]> {
  const root = getTasksRoot();
  await mkdir(root, { recursive: true });
  const recorded = await loadTasksRecord();
  const recordedMap = new Map(recorded.map((t) => [t.taskId, t]));

  let dirs: string[] = [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // ignore
  }

  const result: TaskInfo[] = [];
  const existingSet = new Set<string>();

  for (const name of dirs) {
    existingSet.add(name);
    const taskCwd = join(root, name);
    const existing = recordedMap.get(name) ?? {
      taskId: name,
      cwd: taskCwd,
      createdAt: Date.now(),
      title: name,
    };

    // 显式查询该沙箱目录下的最新会话，确保首问为图片/富文本的会话也能提取出真实标题与 sessionId
    try {
      const sessions = await listSessions({ dir: taskCwd, limit: 1, includeProgrammatic: true });
      const latest = sessions[0];
      if (latest) {
        existing.sessionId = latest.sessionId;
        existing.title = latest.customTitle || latest.summary || latest.firstPrompt || existing.title;
        existing.lastModified = latest.lastModified;
      }
    } catch {
      // ignore
    }

    result.push(existing);
  }

  // Filter out records whose folders no longer exist on disk
  const cleaned = result.sort((a, b) => b.createdAt - a.createdAt);
  if (recorded.length !== cleaned.length || recorded.some((t) => !existingSet.has(t.taskId))) {
    await saveTasksRecord(cleaned);
  }

  return cleaned;
}

export async function createTask(title?: string): Promise<TaskInfo> {
  const root = getTasksRoot();
  await mkdir(root, { recursive: true });
  const tasks = await listTasks();

  // Find next numeric ID (e.g., task-1, task-2, ...)
  let maxId = 0;
  for (const t of tasks) {
    const m = t.taskId.match(/^task-(\d+)$/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num > maxId) maxId = num;
    }
  }
  const nextTaskId = `task-${maxId + 1}`;
  const taskCwd = join(root, nextTaskId);

  await mkdir(taskCwd, { recursive: true });

  const newTask: TaskInfo = {
    taskId: nextTaskId,
    cwd: taskCwd,
    createdAt: Date.now(),
    title: title?.trim() || `任务 #${maxId + 1}`,
  };

  const updated = [newTask, ...tasks.filter((t) => t.taskId !== nextTaskId)];
  await saveTasksRecord(updated);

  return newTask;
}

export async function deleteTask(taskId: string, manager: LiveManager): Promise<void> {
  const root = resolve(getTasksRoot());
  const tasks = await listTasks();
  const target = tasks.find((t) => t.taskId === taskId);

  const targetDir = target ? resolve(target.cwd) : resolve(join(root, taskId));

  // Security check: ensure targetDir is strictly inside root and not root itself
  if (!targetDir.startsWith(root) || targetDir === root) {
    throw new Error('非法路径：无法删除非任务沙箱目录');
  }

  // 1. Stop any live processes running in this directory
  const lives = manager.list().filter((s) => s.cwd && resolve(s.cwd) === targetDir);
  for (const live of lives) {
    try {
      await manager.stopSession(live.sessionId);
    } catch {
      // ignore
    }
  }

  // 2. Delete all sessions stored under this directory via SDK
  try {
    const sessions = await listSessions({ dir: targetDir, includeProgrammatic: true });
    for (const s of sessions) {
      try {
        await deleteSession(s.sessionId, { dir: targetDir });
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  // 3. Physically delete the directory on disk
  if (existsSync(targetDir)) {
    await rm(targetDir, { recursive: true, force: true });
  }

  // 4. Update tasks.json
  const updated = tasks.filter((t) => t.taskId !== taskId);
  await saveTasksRecord(updated);
}
