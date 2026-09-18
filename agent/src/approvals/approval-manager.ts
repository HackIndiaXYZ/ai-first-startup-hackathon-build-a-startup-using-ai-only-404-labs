import { FrameMcpClient } from '../frame/frame-mcp-client';

export class ApprovalManager {
  private frameClient: FrameMcpClient;

  constructor(frameClient: FrameMcpClient) {
    this.frameClient = frameClient;
  }

  /**
   * Submits human approval request.
   * NOTE: Agents CANNOT self-approve. Calling approve() as an agent is strictly forbidden.
   */
  async requestHumanApproval(paymentIntentId: string, notes: string): Promise<boolean> {
    const res = await this.frameClient.requestApproval(paymentIntentId, notes);
    return res.success;
  }

  /**
   * Polls the status of a pending approval.
   */
  async checkApprovalStatus(paymentIntentId: string): Promise<{
    isApproved: boolean;
    isDenied: boolean;
    status: string;
  }> {
    const status = await this.frameClient.getPaymentStatus(paymentIntentId);
    return {
      isApproved: ['SETTLED', 'SUCCEEDED', 'COMPLETED', 'AUTHORIZED'].includes(status.status),
      isDenied: ['DENIED', 'REJECTED', 'FAILED'].includes(status.status),
      status: status.status,
    };
  }
}
