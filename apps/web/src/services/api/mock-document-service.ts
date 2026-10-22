import {
  DocumentItem,
  DocumentDetail,
  UserProfile,
  ProcessDecisionPayload,
  ResubmitPayload,
  CancelPayload,
  DocumentStatus,
  WorkflowStatus,
  StepStatus,
  AssigneeRole,
  AssigneeDecision,
  UrgencyLevel,
  StepType,
  StepCompletionRule,
  UserRole,
  IDocumentService,
  DocumentListQuery,
  DocumentListResult,
} from '@/types/document';

export class MockDocumentService implements IDocumentService {
  private currentUser: UserProfile = {
    id: 'user-current-tp',
    email: 'nguyen.van.a@vinagroup.vn',
    fullName: 'Nguyễn Văn An (Trưởng phòng)',
    role: UserRole.USER,
    organizationId: 'org-hq',
    organizationName: 'Tập đoàn Công nghệ VinaGroup (HQ)',
    departmentId: 'dept-it',
    departmentName: 'Phòng Công nghệ Thông tin',
  };

  private documents: DocumentDetail[] = [
    {
      id: 'doc-001',
      documentNumber: 'TK-2026-0001',
      title: 'Giấy đề nghị tạm ứng công tác phí tham dự Hội nghị TechAsia 2026',
      templateCode: 'TAM_UNG',
      templateTitle: 'Giấy đề nghị tạm ứng',
      status: DocumentStatus.IN_REVIEW,
      urgency: UrgencyLevel.URGENT,
      createdById: 'user-emp-01',
      createdByName: 'Trần Thị Bích (Chuyên viên)',
      organizationId: 'org-hq',
      organizationName: 'VinaGroup HQ',
      departmentName: 'Phòng Công nghệ Thông tin',
      currentStepOrder: 1,
      totalSteps: 2,
      currentStepName: 'Trưởng phòng thẩm tra',
      createdAt: '2026-10-20T08:30:00.000Z',
      updatedAt: '2026-10-20T08:30:00.000Z',
      currentVersion: 1,
      activeVersion: {
        id: 'ver-001-v1',
        versionNumber: 1,
        formData: {
          employeeName: 'Trần Thị Bích',
          employeeCode: 'NV-8821',
          department: 'Phòng Công nghệ Thông tin',
          advanceAmount: 15000000,
          currency: 'VND',
          reason: 'Tạm ứng vé máy bay, khách sạn và lệ phí tham dự Hội nghị Công nghệ TechAsia tại Đà Nẵng',
          reimbursementDeadline: '2026-11-05',
          breakdown: [
            { item: 'Vé máy bay khứ hồi HN - ĐN', cost: 4500000 },
            { item: 'Khách sạn 4 đêm', cost: 6000000 },
            { item: 'Vé tham dự hội thảo & phụ phí', cost: 4500000 },
          ],
        },
        sha256Hash: 'a7c9f82d4b1e56312a0f8976bce43110294b8e3fa52c672b1d91653fa38b2910',
        changeSummary: 'Bản nộp khởi tạo ban đầu',
        createdAt: '2026-10-20T08:30:00.000Z',
      },
      versions: [],
      workflow: {
        id: 'wf-001',
        status: WorkflowStatus.RUNNING,
        currentStepOrder: 1,
        steps: [
          {
            id: 'step-001-1',
            stepOrder: 1,
            stepName: 'Trưởng phòng thẩm tra',
            stepType: StepType.SEQUENTIAL,
            completionRule: StepCompletionRule.ALL_MUST_APPROVE,
            status: StepStatus.IN_PROGRESS,
            assignees: [
              {
                id: 'asg-001-1-1',
                userId: 'user-current-tp',
                userName: 'Nguyễn Văn An (Trưởng phòng)',
                userEmail: 'nguyen.van.a@vinagroup.vn',
                role: AssigneeRole.APPROVER,
                decision: AssigneeDecision.PENDING,
              },
              {
                id: 'asg-001-1-2',
                userId: 'user-rev-01',
                userName: 'Lê Hoàng Nam (Pháp chế)',
                userEmail: 'le.hoang.nam@vinagroup.vn',
                role: AssigneeRole.REVIEWER,
                decision: AssigneeDecision.PENDING,
              },
            ],
          },
          {
            id: 'step-001-2',
            stepOrder: 2,
            stepName: 'Ban Giám Đốc Phê Duyệt & Ký Duyệt Chi',
            stepType: StepType.SEQUENTIAL,
            completionRule: StepCompletionRule.ALL_MUST_APPROVE,
            status: StepStatus.WAITING,
            assignees: [
              {
                id: 'asg-001-2-1',
                userId: 'user-bod-01',
                userName: 'Phạm Minh Đức (Phó Tổng Giám Đốc)',
                userEmail: 'duc.pm@vinagroup.vn',
                role: AssigneeRole.APPROVER,
                decision: AssigneeDecision.PENDING,
              },
            ],
          },
        ],
      },
      decisionHistories: [],
      signatures: [],
      permissions: {
        canApprove: true,
        canResubmit: false,
        canCancel: false,
        isCreator: false,
        isAdmin: false,
        currentStepAssigneeRole: AssigneeRole.APPROVER,
      },
    },
    {
      id: 'doc-002',
      documentNumber: 'TK-2026-0002',
      title: 'Đơn đề nghị thanh toán chi phí đào tạo chứng chỉ Cloud Architect',
      templateCode: 'THANH_TOAN',
      templateTitle: 'Đề nghị thanh toán',
      status: DocumentStatus.REVISION_REQUESTED,
      urgency: UrgencyLevel.NORMAL,
      createdById: 'user-current-tp', // Current user là tác giả
      createdByName: 'Nguyễn Văn An (Trưởng phòng)',
      organizationId: 'org-hq',
      organizationName: 'VinaGroup HQ',
      departmentName: 'Phòng Công nghệ Thông tin',
      currentStepOrder: 1,
      totalSteps: 2,
      currentStepName: 'Kế toán trưởng thẩm định',
      createdAt: '2026-10-18T14:20:00.000Z',
      updatedAt: '2026-10-19T09:15:00.000Z',
      currentVersion: 1,
      activeVersion: {
        id: 'ver-002-v1',
        versionNumber: 1,
        formData: {
          employeeName: 'Nguyễn Văn An',
          courseName: 'AWS Certified Solutions Architect Professional',
          trainingCenter: 'TechCenter Academy',
          invoiceNumber: 'HD-2026-9912',
          amount: 8500000,
          paymentMethod: 'Chuyển khoản trực tiếp',
          note: 'Đề nghị thanh toán theo chính sách hỗ trợ phát triển nhân tài năm 2026',
        },
        sha256Hash: '4f2910bc78d102e88a7c1b5003c461e729a8f4c20d7381b89efc192083ba4129',
        changeSummary: 'Bản nộp ban đầu',
        createdAt: '2026-10-18T14:20:00.000Z',
      },
      versions: [],
      workflow: {
        id: 'wf-002',
        status: WorkflowStatus.RUNNING,
        currentStepOrder: 1,
        steps: [
          {
            id: 'step-002-1',
            stepOrder: 1,
            stepName: 'Kế toán trưởng thẩm định',
            stepType: StepType.SEQUENTIAL,
            completionRule: StepCompletionRule.ALL_MUST_APPROVE,
            status: StepStatus.REVISION_REQUESTED,
            assignees: [
              {
                id: 'asg-002-1',
                userId: 'user-acct-01',
                userName: 'Vũ Thu Trang (Kế toán trưởng)',
                userEmail: 'trang.vt@vinagroup.vn',
                role: AssigneeRole.APPROVER,
                decision: AssigneeDecision.REVISION_REQUESTED,
                decisionComment: 'Hóa đơn VAT đính kèm bị mờ mã tra cứu cơ quan thuế. Vui lòng xuất lại file PDF gốc hóa đơn điện tử.',
                decidedAt: '2026-10-19T09:15:00.000Z',
              },
            ],
          },
        ],
      },
      decisionHistories: [
        {
          id: 'hist-002-1',
          stepOrder: 1,
          stepName: 'Kế toán trưởng thẩm định',
          userId: 'user-acct-01',
          userName: 'Vũ Thu Trang (Kế toán trưởng)',
          role: AssigneeRole.APPROVER,
          decision: AssigneeDecision.REVISION_REQUESTED,
          decisionComment: 'Hóa đơn VAT đính kèm bị mờ mã tra cứu cơ quan thuế. Vui lòng xuất lại file PDF gốc hóa đơn điện tử.',
          decidedAt: '2026-10-19T09:15:00.000Z',
        },
      ],
      signatures: [],
      permissions: {
        canApprove: false,
        canResubmit: true, // Được quyền nộp lại
        canCancel: true,   // Được quyền hủy
        isCreator: true,
        isAdmin: false,
      },
    },
    {
      id: 'doc-003',
      documentNumber: 'TK-2026-0003',
      title: 'Tờ trình đầu tư nâng cấp hệ thống máy chủ cơ sở dữ liệu quý 4',
      templateCode: 'TO_TRINH',
      templateTitle: 'Tờ trình ban giám đốc',
      status: DocumentStatus.APPROVED,
      urgency: UrgencyLevel.EMERGENCY,
      createdById: 'user-current-tp',
      createdByName: 'Nguyễn Văn An (Trưởng phòng)',
      organizationId: 'org-hq',
      organizationName: 'VinaGroup HQ',
      departmentName: 'Phòng Công nghệ Thông tin',
      currentStepOrder: 2,
      totalSteps: 2,
      currentStepName: 'Hoàn tất',
      createdAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-10-16T16:30:00.000Z',
      currentVersion: 1,
      activeVersion: {
        id: 'ver-003-v1',
        versionNumber: 1,
        formData: {
          projectTitle: 'Nâng cấp cụm máy chủ PostgreSQL High-Availability',
          estimatedBudget: 120000000,
          vendor: 'Công ty Cổ phần Giải pháp Hạ tầng Đám Mây CloudPro',
          deploymentDate: '2026-11-01',
          justification: 'Đáp ứng tăng trưởng 200% lưu lượng truy cập hồ sơ trực tuyến của toàn tập đoàn',
        },
        sha256Hash: '98a72b109c3ef71829e018a4bc1982bca19e82cba01928374a819b78ca90192e',
        changeSummary: 'Bản nộp phê duyệt ban giám đốc',
        createdAt: '2026-10-15T10:00:00.000Z',
      },
      versions: [],
      workflow: {
        id: 'wf-003',
        status: WorkflowStatus.COMPLETED,
        currentStepOrder: 2,
        steps: [
          {
            id: 'step-003-1',
            stepOrder: 1,
            stepName: 'Giám đốc Khối Công nghệ thẩm định',
            stepType: StepType.SEQUENTIAL,
            completionRule: StepCompletionRule.ALL_MUST_APPROVE,
            status: StepStatus.COMPLETED,
            assignees: [
              {
                id: 'asg-003-1',
                userId: 'user-cto',
                userName: 'Hoàng Quốc Việt (CTO)',
                userEmail: 'viet.hq@vinagroup.vn',
                role: AssigneeRole.APPROVER,
                decision: AssigneeDecision.APPROVED,
                decisionComment: 'Giải pháp kỹ thuật đạt chuẩn HA, đồng ý trình HĐQT',
                decidedAt: '2026-10-15T15:00:00.000Z',
              },
            ],
          },
          {
            id: 'step-003-2',
            stepOrder: 2,
            stepName: 'Tổng Giám Đốc Phê Duyệt Đầu Tư',
            stepType: StepType.SEQUENTIAL,
            completionRule: StepCompletionRule.ALL_MUST_APPROVE,
            status: StepStatus.COMPLETED,
            assignees: [
              {
                id: 'asg-003-2',
                userId: 'user-ceo',
                userName: 'Nguyễn Đăng Quang (Tổng Giám Đốc)',
                userEmail: 'quang.nd@vinagroup.vn',
                role: AssigneeRole.APPROVER,
                decision: AssigneeDecision.APPROVED,
                decisionComment: 'Chấp thuận triển khai ngay trong tháng 11',
                decidedAt: '2026-10-16T16:30:00.000Z',
              },
            ],
          },
        ],
      },
      decisionHistories: [
        {
          id: 'hist-003-1',
          stepOrder: 1,
          stepName: 'Giám đốc Khối Công nghệ thẩm định',
          userId: 'user-cto',
          userName: 'Hoàng Quốc Việt (CTO)',
          role: AssigneeRole.APPROVER,
          decision: AssigneeDecision.APPROVED,
          decisionComment: 'Giải pháp kỹ thuật đạt chuẩn HA, đồng ý trình HĐQT',
          decidedAt: '2026-10-15T15:00:00.000Z',
        },
        {
          id: 'hist-003-2',
          stepOrder: 2,
          stepName: 'Tổng Giám Đốc Phê Duyệt Đầu Tư',
          userId: 'user-ceo',
          userName: 'Nguyễn Đăng Quang (Tổng Giám Đốc)',
          role: AssigneeRole.APPROVER,
          decision: AssigneeDecision.APPROVED,
          decisionComment: 'Chấp thuận triển khai ngay trong tháng 11',
          decidedAt: '2026-10-16T16:30:00.000Z',
        },
      ],
      signatures: [
        {
          id: 'sig-003-1',
          userId: 'user-ceo',
          userName: 'Nguyễn Đăng Quang (Tổng Giám Đốc)',
          signatureImageUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="20" y="50" font-family="cursive" font-size="28" fill="%231e3a8a">Quang.ND</text></svg>',
          signedAt: '2026-10-16T16:30:00.000Z',
          isValid: true,
          contentHash: '98a72b109c3ef71829e018a4bc1982bca19e82cba01928374a819b78ca90192e',
        },
      ],
      permissions: {
        canApprove: false,
        canResubmit: false,
        canCancel: false,
        isCreator: true,
        isAdmin: false,
      },
    },
  ];

  // Helper mô phỏng độ trễ mạng tự nhiên
  private delay(ms = 300): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async getCurrentUser(): Promise<UserProfile> {
    await this.delay(100);
    return this.currentUser;
  }

  public async getDocuments(
    tab: 'pending_my_approval' | 'my_documents' | 'all',
    query?: DocumentListQuery
  ): Promise<DocumentItem[]> {
    await this.delay(250);
    const userId = this.currentUser.id;

    let result = this.documents;

    if (tab === 'pending_my_approval') {
      result = this.documents.filter((doc) => {
        if (doc.status !== DocumentStatus.IN_REVIEW) return false;
        const currentStep = doc.workflow.steps.find((s) => s.stepOrder === doc.currentStepOrder);
        return currentStep?.assignees.some(
          (a) => a.userId === userId && a.decision === AssigneeDecision.PENDING && a.role === AssigneeRole.APPROVER
        );
      });
    } else if (tab === 'my_documents') {
      result = this.documents.filter((doc) => doc.createdById === userId);
    }

    if (query?.status && query.status !== 'ALL') {
      result = result.filter((doc) => doc.status === query.status);
    }

    if (query?.search?.trim()) {
      const s = query.search.toLowerCase();
      result = result.filter(
        (doc) =>
          doc.title.toLowerCase().includes(s) ||
          doc.documentNumber.toLowerCase().includes(s)
      );
    }

    return result;
  }

  public async getDocumentList(
    tab: 'pending_my_approval' | 'my_documents' | 'all',
    query?: DocumentListQuery
  ): Promise<DocumentListResult> {
    const items = await this.getDocuments(tab, query);
    const page = query?.page || 1;
    const limit = query?.limit || 10;
    const total = items.length;
    const startIndex = (page - 1) * limit;
    const paginatedItems = items.slice(startIndex, startIndex + limit);

    return {
      items: paginatedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  public async getDocumentDetail(id: string): Promise<DocumentDetail> {
    await this.delay(300);
    const doc = this.documents.find((d) => d.id === id);
    if (!doc) {
      throw new Error(`Không tìm thấy hồ sơ với id: ${id}`);
    }
    // Deep clone để tránh đột biến ngoài ý muốn
    return JSON.parse(JSON.stringify(doc));
  }

  public async processDecision(id: string, payload: ProcessDecisionPayload): Promise<{ success: boolean; documentStatus: DocumentStatus }> {
    await this.delay(400);
    const doc = this.documents.find((d) => d.id === id);
    if (!doc) throw new Error('Không tìm thấy hồ sơ');

    const currentStep = doc.workflow.steps.find((s) => s.stepOrder === doc.currentStepOrder);
    if (!currentStep) throw new Error('Không tìm thấy bước duyệt');

    const assignee = currentStep.assignees.find((a) => a.userId === this.currentUser.id);
    if (!assignee) {
      const alreadyDecided = doc.workflow.steps.some((s) =>
        s.assignees.some((a) => a.userId === this.currentUser.id && a.decision !== AssigneeDecision.PENDING)
      );
      if (alreadyDecided) {
        const err: any = new Error('Xung đột tương tranh: Quyết định của người duyệt đã được xử lý bởi một yêu cầu trước đó.');
        err.code = 'CONCURRENCY_CONFLICT';
        throw err;
      }
      throw new Error('Bạn không có phân công trong bước này');
    }
    if (assignee.decision !== AssigneeDecision.PENDING) {
      const err: any = new Error('Xung đột tương tranh: Bạn đã xử lý bước này trước đó.');
      err.code = 'CONCURRENCY_CONFLICT';
      throw err;
    }

    const now = new Date().toISOString();
    assignee.decision = payload.decision;
    assignee.decisionComment = payload.decisionComment;
    assignee.decidedAt = now;

    // Ghi nhận lịch sử
    doc.decisionHistories.push({
      id: `hist-${Date.now()}`,
      stepOrder: currentStep.stepOrder,
      stepName: currentStep.stepName,
      userId: this.currentUser.id,
      userName: this.currentUser.fullName,
      role: assignee.role,
      decision: payload.decision,
      decisionComment: payload.decisionComment,
      decidedAt: now,
    });

    if (payload.decision === AssigneeDecision.APPROVED) {
      if (payload.signatureImageUrl) {
        doc.signatures.push({
          id: `sig-${Date.now()}`,
          userId: this.currentUser.id,
          userName: this.currentUser.fullName,
          signatureImageUrl: payload.signatureImageUrl,
          signedAt: now,
          isValid: true,
          contentHash: doc.activeVersion.sha256Hash,
        });
      }

      currentStep.status = StepStatus.COMPLETED;
      const nextStep = doc.workflow.steps.find((s) => s.stepOrder === currentStep.stepOrder + 1);
      if (nextStep) {
        nextStep.status = StepStatus.IN_PROGRESS;
        doc.currentStepOrder = nextStep.stepOrder;
        doc.currentStepName = nextStep.stepName;
      } else {
        doc.status = DocumentStatus.APPROVED;
        doc.workflow.status = WorkflowStatus.COMPLETED;
        doc.currentStepName = 'Hoàn tất';
      }
    } else if (payload.decision === AssigneeDecision.REJECTED) {
      currentStep.status = StepStatus.REJECTED;
      doc.status = DocumentStatus.REJECTED;
      doc.workflow.status = WorkflowStatus.REJECTED;
    } else if (payload.decision === AssigneeDecision.REVISION_REQUESTED) {
      currentStep.status = StepStatus.REVISION_REQUESTED;
      doc.status = DocumentStatus.REVISION_REQUESTED;
      doc.signatures.forEach((s) => (s.isValid = false));
    }

    doc.updatedAt = now;
    doc.permissions.canApprove = false;
    return { success: true, documentStatus: doc.status };
  }

  public async resubmitDocument(id: string, payload: ResubmitPayload): Promise<{ success: boolean; newVersionNumber: number }> {
    await this.delay(400);
    const doc = this.documents.find((d) => d.id === id);
    if (!doc) throw new Error('Không tìm thấy hồ sơ');

    const now = new Date().toISOString();
    const newVerNumber = doc.currentVersion + 1;
    doc.currentVersion = newVerNumber;

    const newVer = {
      id: `ver-${doc.id}-v${newVerNumber}`,
      versionNumber: newVerNumber,
      formData: payload.formData,
      sha256Hash: `hash-v${newVerNumber}-${Date.now()}`,
      changeSummary: payload.changeSummary || 'Nộp lại sau chỉnh sửa',
      createdAt: now,
    };

    doc.activeVersion = newVer;
    doc.status = DocumentStatus.IN_REVIEW;
    doc.currentStepOrder = 1;
    doc.currentStepName = doc.workflow.steps[0].stepName;
    doc.workflow.steps[0].status = StepStatus.IN_PROGRESS;
    doc.workflow.steps[0].assignees.forEach((a) => {
      a.decision = AssigneeDecision.PENDING;
      a.decisionComment = undefined;
    });

    for (let i = 1; i < doc.workflow.steps.length; i++) {
      doc.workflow.steps[i].status = StepStatus.WAITING;
      doc.workflow.steps[i].assignees.forEach((a) => {
        a.decision = AssigneeDecision.PENDING;
        a.decisionComment = undefined;
      });
    }

    doc.permissions.canResubmit = false;
    doc.permissions.canCancel = true;
    doc.updatedAt = now;
    return { success: true, newVersionNumber: newVerNumber };
  }

  public async cancelDocument(id: string, payload: CancelPayload): Promise<{ success: boolean }> {
    await this.delay(350);
    const doc = this.documents.find((d) => d.id === id);
    if (!doc) throw new Error('Không tìm thấy hồ sơ');

    doc.status = DocumentStatus.CANCELLED;
    doc.workflow.status = WorkflowStatus.CANCELLED;
    doc.workflow.steps.forEach((s) => {
      if (s.status === StepStatus.IN_PROGRESS || s.status === StepStatus.WAITING || s.status === StepStatus.REVISION_REQUESTED) {
        s.status = StepStatus.CANCELLED;
      }
    });

    doc.permissions.canApprove = false;
    doc.permissions.canResubmit = false;
    doc.permissions.canCancel = false;
    doc.updatedAt = new Date().toISOString();
    return { success: true };
  }

  public async createDocument(
    payload: import('@/types/template').CreateDocumentPayload
  ): Promise<import('@/types/template').CreatedDocumentResult> {
    await this.delay(350);
    const id = `mock-doc-${Date.now()}`;
    const docNumber = `TK-2026-${String(this.documents.length + 1).padStart(4, '0')}`;
    const now = new Date().toISOString();

    const newDoc: DocumentDetail = {
      id,
      documentNumber: docNumber,
      title: payload.title,
      templateCode: 'DYNAMIC_FORM',
      templateTitle: 'Hồ sơ biểu mẫu',
      status: DocumentStatus.DRAFT,
      urgency: (payload.urgency as any) || 'NORMAL',
      createdById: this.currentUser.id,
      createdByName: this.currentUser.fullName,
      organizationId: this.currentUser.organizationId,
      organizationName: this.currentUser.organizationName,
      departmentName: this.currentUser.departmentName,
      currentStepOrder: 1,
      totalSteps: 1,
      currentStepName: 'Cấp quản lý duyệt',
      createdAt: now,
      updatedAt: now,
      currentVersion: 1,
      versions: [
        {
          id: `v1-${id}`,
          versionNumber: 1,
          formData: payload.formData,
          sha256Hash: 'mock-sha256-hash',
          changeSummary: 'Khởi tạo hồ sơ ban đầu',
          createdAt: now,
        },
      ],
      activeVersion: {
        id: `v1-${id}`,
        versionNumber: 1,
        formData: payload.formData,
        sha256Hash: 'mock-sha256-hash',
        changeSummary: 'Khởi tạo hồ sơ ban đầu',
        createdAt: now,
      },
      workflow: {
        id: `wf-${id}`,
        status: WorkflowStatus.PENDING,
        currentStepOrder: 1,
        steps: [
          {
            id: `step-1-${id}`,
            stepOrder: 1,
            stepName: 'Cấp quản lý phê duyệt',
            stepType: StepType.SEQUENTIAL,
            completionRule: StepCompletionRule.ALL_MUST_APPROVE,
            status: StepStatus.WAITING,
            assignees: [],
          },
        ],
      },
      decisionHistories: [],
      signatures: [],
      permissions: {
        canApprove: false,
        canResubmit: false,
        canCancel: true,
        isCreator: true,
        isAdmin: true,
      },
    };

    this.documents.unshift(newDoc);

    return {
      id,
      documentNumber: docNumber,
      title: newDoc.title,
      status: newDoc.status,
      currentVersion: 1,
      templateId: payload.templateId,
      templateVersionNumber: 1,
      createdAt: now,
    };
  }
}

export const mockDocumentService = new MockDocumentService();
