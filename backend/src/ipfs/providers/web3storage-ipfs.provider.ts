/**
 * Web3.Storage IPFS Provider
 *
 * Implementation for Web3.Storage IPFS pinning service.
 * Provides a fallback provider option in the IPFS provider chain.
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import { IpfsProvider, IpfsUploadResult } from '../interfaces/ipfs-provider.interface';

interface Web3StorageUploadResponse {
  cid: string;
  size: number;
  created?: string;
}

@Injectable()
export class Web3StorageIpfsProvider implements IpfsProvider {
  readonly name = 'web3storage';
  private readonly logger = new Logger(Web3StorageIpfsProvider.name);
  private readonly apiToken: string | undefined;
  private readonly gatewayUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiToken = this.configService.get<string>('WEB3STORAGE_API_TOKEN');
    this.gatewayUrl = this.configService.get<string>('WEB3STORAGE_GATEWAY_URL', 'https://w3s.link/ipfs');

    if (!this.apiToken) {
      this.logger.warn('Web3.Storage API token not configured. Provider will be unavailable.');
    }
  }

  /**
   * Upload file to Web3.Storage
   */
  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options?: Record<string, unknown>,
  ): Promise<IpfsUploadResult> {
    if (!this.apiToken) {
      throw new UnauthorizedException('Web3.Storage API token not configured');
    }

    try {
      const form = new FormData();
      form.append('file', buffer, {
        filename,
        contentType: mimeType,
      });

      // Add metadata if provided
      const metadata = options?.metadata as Record<string, string> | undefined;
      if (metadata) {
        form.append('meta', JSON.stringify(metadata));
      }

      this.logger.debug(`Uploading ${filename} (${buffer.length} bytes) to Web3.Storage`);

      const response = await axios.post<Web3StorageUploadResponse>(
        'https://api.web3.storage/upload',
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${this.apiToken}`,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 120000, // 120s for large files
        },
      );

      const result: IpfsUploadResult = {
        cid: response.data.cid,
        size: response.data.size ?? buffer.length,
        mimeType,
        originalName: filename,
        pinnedAt: response.data.created ? new Date(response.data.created) : new Date(),
      };

      this.logger.log(`Successfully pinned ${result.cid} to IPFS via Web3.Storage`);
      return result;
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { message?: string }; status?: number }; message?: string };
      const errorMessage = axiosError?.response?.data?.message || axiosError?.message || 'Unknown error';
      this.logger.error(`Web3.Storage upload failed: ${errorMessage}`);
      throw new Error(`Web3.Storage upload failed: ${errorMessage}`);
    }
  }

  /**
   * Check if content exists on Web3.Storage
   */
  async exists(cid: string): Promise<boolean> {
    try {
      const response = await axios.head(`${this.gatewayUrl}/${cid}`, {
        timeout: 10000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Web3.Storage does not support unpinning via API for free tier.
   * Returns false to indicate unsupported operation.
   */
  async unpin(cid: string): Promise<boolean> {
    void cid;
    this.logger.warn('Web3.Storage provider does not support unpinning');
    return false;
  }

  /**
   * Check if Web3.Storage API is accessible
   */
  async isHealthy(): Promise<boolean> {
    if (!this.apiToken) {
      return false;
    }
    try {
      // Web3.Storage status endpoint
      const response = await axios.get('https://api.web3.storage/status', {
        headers: { Authorization: `Bearer ${this.apiToken}` },
        timeout: 10000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Get public gateway URL for a CID
   */
  getGatewayUrl(cid: string): string {
    return `${this.gatewayUrl}/${cid}`;
  }
}

