import { z } from "zod";

export const projectMemberRoleSchema = z.enum(["hardware-user", "software-user", "hardware-committer", "software-committer"]);
export const projectMemberSchema = z.object({
  userId: z.string(), name: z.string(), username: z.string().nullable(), title: z.string(),
  isActive: z.boolean(), roles: z.array(projectMemberRoleSchema)
});
export const projectMembersSchema = z.object({ projectId: z.string(), members: z.array(projectMemberSchema) });
export const updateProjectMemberBodySchema = z.object({ roles: z.array(projectMemberRoleSchema), expectedRoles: z.array(projectMemberRoleSchema) }).strict();
export const projectMembersDtoSchemaCatalog = { ProjectMembersResponse: projectMembersSchema, UpdateProjectMemberBody: updateProjectMemberBodySchema };
export const projectMembersCoveredRouteIds = ["users.getProjectMembers", "users.updateProjectMember"] as const;
export const projectMembersSchemaRegistry = {
  "users.getProjectMembers": {
    summary: "Read explicit project editing participation, separately from review duties",
    tags: ["users" as const], responseBody: "ProjectMembersResponse",
    requestParameters: [{ name: "organizationId", in: "query" as const, schema: { type: "string" as const } }],
    additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse" }
  },
  "users.updateProjectMember": {
    summary: "Assign or remove project editing participation without granting review duties",
    tags: ["users" as const], requestBody: "UpdateProjectMemberBody", responseBody: "ProjectMembersResponse",
    requestParameters: [{ name: "organizationId", in: "query" as const, schema: { type: "string" as const } }],
    additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" }
  }
};
