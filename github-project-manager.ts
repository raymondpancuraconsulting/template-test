import { GraphQLClient, gql } from 'graphql-request';

// Types for the API responses and parameters
interface ProjectItem {
  project: {
    id: string;
  };
  id: string;
  fieldValues: {
    nodes: Array<{
      field: {
        name: string;
      };
      value: string;
    }>;
  };
}

interface IssueNode {
  projectItems: {
    nodes: ProjectItem[];
  };
}

interface GetFieldValueResponse {
  node: IssueNode;
}

interface UpdateFieldValueResponse {
  updateProjectV2ItemFieldValue: {
    projectV2Item: {
      id: string;
    };
  };
}

class GitHubProjectManager {
  private client: GraphQLClient;

  constructor(token: string, apiUrl: string = 'https://api.github.com/graphql') {
    this.client = new GraphQLClient(apiUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  private async getCustomFieldValue(
    issueId: string,
    projectId: string,
    fieldName: string
  ): Promise<string | null> {
    const query = gql`
      query GetCustomFieldValue($issueId: ID!) {
        node(id: $issueId) {
          ... on Issue {
            projectItems(first: 10) {
              nodes {
                project {
                  id
                }
                id
                fieldValues(first: 10) {
                  nodes {
                    field {
                      name
                    }
                    value
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.client.request<GetFieldValueResponse>(query, {
        issueId,
      });

      const projectItem = data.node.projectItems.nodes.find(
        (item) => item.project.id === projectId
      );

      if (!projectItem) {
        throw new Error(`Issue ${issueId} not found in project ${projectId}`);
      }

      const field = projectItem.fieldValues.nodes.find(
        (field) => field.field.name === fieldName
      );

      return field?.value ?? null;
    } catch (error) {
      throw new Error(
        `Failed to get custom field value: ${(error as Error).message}`
      );
    }
  }

  private async updateCustomFieldValue(
    issueId: string,
    projectId: string,
    fieldName: string,
    fieldValue: string
  ): Promise<void> {
    const mutation = gql`
      mutation UpdateCustomField(
        $projectId: ID!
        $itemId: ID!
        $fieldValue: String!
      ) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldValue: { text: $fieldValue }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `;

    try {
      await this.client.request<UpdateFieldValueResponse>(mutation, {
        projectId,
        itemId: issueId,
        fieldValue,
      });
      console.log(
        `Updated custom field "${fieldName}" to "${fieldValue}" for issue ${issueId}`
      );
    } catch (error) {
      throw new Error(
        `Failed to update custom field value: ${(error as Error).message}`
      );
    }
  }

  async propagateCustomField(
    parentIssueId: string,
    childIssueIds: string[],
    projectId: string,
    fieldName: string
  ): Promise<void> {
    try {
      const parentFieldValue = await this.getCustomFieldValue(
        parentIssueId,
        projectId,
        fieldName
      );

      if (!parentFieldValue) {
        throw new Error(
          `No value found for custom field "${fieldName}" in parent issue ${parentIssueId}`
        );
      }

      const results = await Promise.allSettled(
        childIssueIds.map((childId) =>
          this.updateCustomFieldValue(
            childId,
            projectId,
            fieldName,
            parentFieldValue
          )
        )
      );

      // Report on failures while allowing successes to proceed
      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      );

      if (failures.length > 0) {
        console.error(
          'Some updates failed:',
          failures.map((f) => f.reason).join('\n')
        );
      }

      const successCount = results.length - failures.length;
      console.log(
        `Successfully propagated field "${fieldName}" to ${successCount}/${childIssueIds.length} child issues`
      );
    } catch (error) {
      throw new Error(`Field propagation failed: ${(error as Error).message}`);
    }
  }
}

// Example usage
async function main() {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? 'your_personal_access_token';
  const manager = new GitHubProjectManager(GITHUB_TOKEN);

  try {
    await manager.propagateCustomField(
      'PARENT_ISSUE_ID', // Replace with actual parent issue ID
      ['CHILD_ISSUE_ID_1', 'CHILD_ISSUE_ID_2'], // Replace with actual child issue IDs
      'PROJECT_ID', // Replace with actual project ID
      'Initiative'
    );
  } catch (error) {
    console.error('Failed to propagate custom field:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export default GitHubProjectManager;
