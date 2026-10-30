/** Ski School HQ runtime: lessons limited by the instructor count, a waiting queue, a per-kid fee and skill progression. No three/DOM imports. */
export const SKI_SCHOOL = {
  defaultInstructors: 2,
  maxInstructors: 12,
  /** Kids one instructor can teach per lesson. */
  kidsPerInstructor: 4,
  /** Lesson length in ticks (6 game minutes each => 2 h). */
  lessonTicks: 20,
  /** Fee per kid per lesson. */
  fee: 30,
  /** Skill experience granted at the end of a lesson. */
  lessonXp: 4,
} as const;

export interface LessonGroup { group: number; kids: number[]; joined: number; started: number; end: number }

export interface SkiSchoolHooks {
  /** Lesson fee income ('lessons' ledger category). */
  earn?: (category: string, amount: number) => void;
  onStarted?: (schoolId: number, kids: number[], instructors: number) => void;
  /** Lesson finished: the runtime grants skill/happiness to the kids through this callback. */
  onFinished?: (schoolId: number, g: LessonGroup, fee: number) => void;
  /** Staff pool fill x instructor-training modifier (1 = untouched; Task 19 / 20). */
  capacityFactor?: () => number;
}

export class SkiSchool {
  instructors: number = SKI_SCHOOL.defaultInstructors;
  readonly queue: LessonGroup[] = [];
  readonly active: LessonGroup[] = [];
  lessonsToday = 0;
  lessonsTotal = 0;
  private day = -1;

  constructor(readonly id: number, private hooks: SkiSchoolHooks = {}) {}

  setInstructors(n: number): void { this.instructors = Math.max(0, Math.min(SKI_SCHOOL.maxInstructors, Math.floor(n))); }
  get capacity(): number { return Math.floor(this.instructors * SKI_SCHOOL.kidsPerInstructor * (this.hooks.capacityFactor?.() ?? 1)); }
  get activeKids(): number { return this.active.reduce((a, g) => a + g.kids.length, 0); }
  get queuedKids(): number { return this.queue.reduce((a, g) => a + g.kids.length, 0); }
  /** 0..1: how well the instructors cover the demand (instructor ratio), used as school quality. */
  quality(): number {
    const demand = this.activeKids + this.queuedKids;
    return demand <= 0 ? 1 : Math.min(1, this.capacity / demand);
  }
  isOpen(): boolean { return this.instructors > 0; }
  lessonOf(kid: number): 'active' | 'queued' | null {
    if (this.active.some((g) => g.kids.includes(kid))) return 'active';
    if (this.queue.some((g) => g.kids.includes(kid))) return 'queued';
    return null;
  }

  /** Enrol a family's kids (they pay on start). A group is taught together, so it needs room for all of its kids. */
  enroll(group: number, kids: number[], tick: number): void {
    this.queue.push({ group, kids: [...kids], joined: tick, started: -1, end: -1 });
  }

  /** Remove a group's kids from the queue/active lessons (family left / venue closed). Unpaid queued kids cost nothing. */
  withdraw(group: number): void {
    for (const list of [this.queue, this.active]) for (let i = list.length - 1; i >= 0; i--) if (list[i]!.group === group) list.splice(i, 1);
  }

  /** True while a lesson batch of this group waits or runs. */
  pending(group: number): boolean { return this.queue.some((g) => g.group === group) || this.active.some((g) => g.group === group); }

  newDay(day: number): void { if (day !== this.day) { this.day = day; this.lessonsToday = 0; } }

  update(tick: number): void {
    for (let i = 0; i < this.active.length;) {
      const g = this.active[i]!;
      if (tick >= g.end) {
        const fee = SKI_SCHOOL.fee * g.kids.length;
        this.active.splice(i, 1);
        this.hooks.earn?.('lessons', fee);
        this.hooks.onFinished?.(this.id, g, fee);
      } else i++;
    }
    for (let i = 0; i < this.queue.length;) {
      const g = this.queue[i]!;
      if (this.capacity - this.activeKids >= g.kids.length) {
        this.queue.splice(i, 1);
        g.started = tick; g.end = tick + SKI_SCHOOL.lessonTicks;
        this.active.push(g);
        this.lessonsToday++; this.lessonsTotal++;
        this.hooks.onStarted?.(this.id, g.kids, this.instructors);
      } else i++;
    }
  }

  serialize(): { instructors: number; lessonsToday: number; lessonsTotal: number; day: number; queue?: LessonGroup[]; active?: LessonGroup[] } {
    return {
      instructors: this.instructors, lessonsToday: this.lessonsToday, lessonsTotal: this.lessonsTotal, day: this.day,
      queue: this.queue.map((g) => ({ ...g, kids: [...g.kids] })), active: this.active.map((g) => ({ ...g, kids: [...g.kids] })),
    };
  }
  load(d: ReturnType<SkiSchool['serialize']>): void {
    this.instructors = d.instructors; this.lessonsToday = d.lessonsToday; this.lessonsTotal = d.lessonsTotal; this.day = d.day;
    if (d.queue) { this.queue.length = 0; for (const g of d.queue) this.queue.push({ ...g, kids: [...g.kids] }); }
    if (d.active) { this.active.length = 0; for (const g of d.active) this.active.push({ ...g, kids: [...g.kids] }); }
  }
}
