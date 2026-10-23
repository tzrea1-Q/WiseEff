import type { Queryable } from "../../shared/database/client";

export type ProjectMemberRoleId = "hardware-user" | "software-user" | "hardware-committer" | "software-committer";
export type ProjectMemberDto = {
  userId: string;
  name: string;
  username: string | null;
  title: string;
  isActive: boolean;
  roles: ProjectMemberRoleId[];
};

/** Explicit participation only; user_role_bindings remains the review-duty source. */
export async function listProjectMembers(db: Queryable, organizationId: string, projectId: string): Promise<ProjectMemberDto[]> {
  return (await db.query<ProjectMemberDto>(`
    select member.user_id as "userId", person.name, credentials.username, person.title,
      person.is_active as "isActive", member.roles
    from project_members member
    join users person on person.id = member.user_id and person.organization_id = member.organization_id
    left join user_password_credentials credentials on credentials.user_id = person.id
    where member.organization_id = $1 and member.project_id = $2
    order by person.name, person.id`, [organizationId, projectId])).rows;
}
