/**
 * The ChargeLab acceptance cast: the single definition of the people every acceptance
 * surface seeds and signs in as. Data only — seeding stays with each consumer
 * (pg-client helpers, the disposable runtime, spec-local upserts) so this module works
 * for all of them.
 *
 * Before this module the cast lived in four verbatim copies (bearerAuth, roleFixtures,
 * disposablePostCutoverRuntime, and inline in parameters.acceptance.spec.ts) that had
 * to agree by hand.
 */

export const ACCEPTANCE_ORGANIZATION = { id: "org-chargelab", name: "ChargeLab" } as const;

export type AcceptanceCastMember = {
  userId: string;
  name: string;
  email: string;
  title: string;
};

export const acceptanceCast = {
  xuYun: { userId: "u-xu-yun", name: "Xu Yun", email: "xu@chargelab.cn", title: "Platform Owner" },
  zhaoHeng: {
    userId: "u-zhao-heng",
    name: "Zhao Heng",
    email: "zhao@chargelab.cn",
    title: "Hardware Engineer"
  },
  liuMin: { userId: "u-liu-min", name: "Liu Min", email: "liu@chargelab.cn", title: "Software Engineer" },
  wangJie: { userId: "u-wang-jie", name: "Wang Jie", email: "wang@chargelab.cn", title: "Hardware Reviewer" },
  chenNa: { userId: "u-chen-na", name: "Chen Na", email: "chen@chargelab.cn", title: "Software Integrator" },
  liPeng: { userId: "u-li-peng", name: "Li Peng", email: "lipeng@chargelab.cn", title: "Hardware Committer" },
  sunMei: { userId: "u-sun-mei", name: "Sun Mei", email: "sun@chargelab.cn", title: "Software Reviewer" },
  acceptanceGuest: {
    userId: "acceptance-role-guest",
    name: "Acceptance Guest",
    email: "acceptance.guest@chargelab.cn",
    title: "Guest Viewer"
  },
  /** Org-Admin-only actor for PERM-MATRIX (seed-m0 also binds platform-admin on u-xu-yun). */
  acceptanceAdmin: {
    userId: "acceptance-role-admin",
    name: "Acceptance Admin",
    email: "acceptance.admin@chargelab.cn",
    title: "Org Admin"
  },
  platformOperator: {
    userId: "u-platform-admin",
    name: "Platform Operator",
    email: "platform@chargelab.cn",
    title: "Platform Super Admin"
  }
} satisfies Record<string, AcceptanceCastMember>;

/** The seven ChargeLab people the seeds create as the demo organization. */
export const chargeLabCast: readonly AcceptanceCastMember[] = [
  acceptanceCast.xuYun,
  acceptanceCast.zhaoHeng,
  acceptanceCast.liuMin,
  acceptanceCast.wangJie,
  acceptanceCast.chenNa,
  acceptanceCast.liPeng,
  acceptanceCast.sunMei
];

/** Which cast member each acceptance role signs in as. */
export const castByRole = {
  guest: acceptanceCast.acceptanceGuest,
  "hardware-user": acceptanceCast.zhaoHeng,
  "software-user": acceptanceCast.liuMin,
  "hardware-committer": acceptanceCast.wangJie,
  "software-committer": acceptanceCast.sunMei,
  admin: acceptanceCast.xuYun,
  "platform-admin": acceptanceCast.platformOperator
} as const;

export type AcceptanceRoleId = keyof typeof castByRole;

export const roleLabels: Record<AcceptanceRoleId, string> = {
  guest: "Guest",
  "hardware-user": "Hardware User",
  "software-user": "Software User",
  "hardware-committer": "Hardware Committer",
  "software-committer": "Software Committer",
  admin: "Admin",
  "platform-admin": "Platform Super Admin"
};
