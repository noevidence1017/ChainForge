import { useActivityStore } from '@/lib/activityStore';

/**
 * Utility functions for managing activities in the activity center.
 */
export function useActivity() {
  const { addActivity, updateActivity } = useActivityStore();

  const trackTransaction = async (
    title: string,
    description: string,
    action: () => Promise<{ transactionHash?: string; explorerUrl?: string }>,
    options?: {
      retryAction?: () => Promise<{ transactionHash?: string; explorerUrl?: string }>;
      onSuccess?: (result: { transactionHash?: string; explorerUrl?: string }) => void;
      onError?: (error: Error) => void;
    }
  ) => {
    // Add pending activity
    const activityId = addActivity({
      type: 'transaction',
      status: 'pending',
      title,
      description,
      currentStep: 'Preparing transaction...',
      retryAction: options?.retryAction,
    });

    try {
      const result = await action();
      updateActivity(activityId, {
        status: 'succeeded',
        currentStep: 'Transaction completed',
        transactionHash: result.transactionHash,
        explorerUrl: result.explorerUrl,
      });
      options?.onSuccess?.(result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      updateActivity(activityId, {
        status: 'failed',
        currentStep: 'Transaction failed',
        errorMessage: err.message,
      });
      options?.onError?.(err);
      throw err;
    }
  };

  const trackJob = async <T = unknown>(
    title: string,
    description: string,
    action: () => Promise<T>,
    options?: {
      retryAction?: () => Promise<T>;
      onSuccess?: (result: T) => void;
      onError?: (error: Error) => void;
    }
  ) => {
    // Add pending activity
    const activityId = addActivity({
      type: 'job',
      status: 'processing',
      title,
      description,
      currentStep: 'Processing...',
      retryAction: options?.retryAction,
    });

    try {
      const result = await action();
      updateActivity(activityId, {
        status: 'succeeded',
        currentStep: 'Completed successfully',
      });
      options?.onSuccess?.(result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      updateActivity(activityId, {
        status: 'failed',
        currentStep: 'Failed',
        errorMessage: err.message,
      });
      options?.onError?.(err);
      throw err;
    }
  };

  return { trackTransaction, trackJob };
}