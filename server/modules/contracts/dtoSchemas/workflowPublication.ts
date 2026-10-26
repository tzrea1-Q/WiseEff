import { itemEnvelopeSchema } from "./envelopes";
import {
  updateWorkflowPublicationSchema,
  workflowPublicationAdminStateSchema,
  workflowPublicationStateSchema
} from "../../workflow-publication/schemas";

export { workflowPublicationAdminStateSchema, workflowPublicationStateSchema };

export const workflowPublicationDtoSchemaCatalog = {
  WorkflowPublicationResponse: itemEnvelopeSchema(workflowPublicationStateSchema),
  WorkflowPublicationAdminResponse: itemEnvelopeSchema(workflowPublicationAdminStateSchema),
  UpdateWorkflowPublicationRequest: updateWorkflowPublicationSchema
};

export const workflowPublicationRoutes = [
  { id: "workflowPublication.get", method: "GET", path: "/api/v1/workflow-publication", module: "workflow-publication", stability: "commercial-readiness" },
  { id: "workflowPublication.adminGet", method: "GET", path: "/api/v1/admin/workflow-publication", module: "workflow-publication", stability: "commercial-readiness" },
  { id: "workflowPublication.update", method: "PUT", path: "/api/v1/admin/workflow-publication", module: "workflow-publication", stability: "commercial-readiness" }
] as const;

export const workflowPublicationCoveredRouteIds = workflowPublicationRoutes.map((route) => route.id);

export const workflowPublicationSchemaRegistry = {
  "workflowPublication.get": {
    summary: "Get global UI workflow publication without management metadata",
    tags: ["workflow-publication" as const], responseBody: "WorkflowPublicationResponse",
    additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "500": "ErrorResponse" }
  },
  "workflowPublication.adminGet": {
    summary: "Get global workflow publication and last editor; platform super administrator only",
    tags: ["workflow-publication" as const], responseBody: "WorkflowPublicationAdminResponse",
    additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "500": "ErrorResponse" }
  },
  "workflowPublication.update": {
    summary: "Update global UI workflow publication with an optimistic version; platform super administrator only",
    tags: ["workflow-publication" as const], requestBody: "UpdateWorkflowPublicationRequest", responseBody: "WorkflowPublicationAdminResponse",
    additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "409": "ErrorResponse", "500": "ErrorResponse" }
  }
};
