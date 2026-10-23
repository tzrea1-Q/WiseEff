import { z } from "zod";

export const projectMemberRoleSchema = z.enum(["hardware-user", "software-user", "hardware-committer", "software-committer"]);
export const projectMemberSchema = z.object({
  userId: z.string(), name: z.string(), username: z.string().nullable(), title: z.string(),
  isActive: z.boolean(), roles: z.array(projectMemberRoleSchema)
});
export const projectMembersSchema = z.object({ projectId: z.string(), members: z.array(projectMemberSchema) });
export const projectMembersDtoSchemaCatalog = { ProjectMembersResponse: projectMembersSchema };
export const projectMembersCoveredRouteIds = ["users.getProjectMembers"] as const;
export const projectMembersSchemaRegistry = {
  "users.getProjectMembers": {
    summary: "Read explicit project participation without changing legacy edit or workflow authorization",
    tags: ["users" as const], responseBody: "ProjectMembersResponse",
    requestParameters: [{ name: "organizationId", in: "query" as const, schema: { type: "string" as const } }],
    additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
  }
};
