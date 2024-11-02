const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const readline = require("readline");
const { DateTime } = require("luxon");
const { HttpsProxyAgent } = require("https-proxy-agent");

class PawsClient {
  constructor() {
    this.headers = {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language":
        "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/json",
      Origin: "https://app.paws.community",
      Referer: "https://app.paws.community/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1",
    };
    this.tokenFile = path.join(__dirname, "token.json");
    this.tokens = this.loadTokens();
    this.wallets = this.loadWallets();
    this.proxies = this.loadProxies();
  }

  loadWallets() {
    try {
      const walletFile = path.join(__dirname, "wallet.txt");
      if (fs.existsSync(walletFile)) {
        return fs
          .readFileSync(walletFile, "utf8")
          .replace(/\r/g, "")
          .split("\n")
          .filter(Boolean);
      }
      return [];
    } catch (error) {
      this.log(`Lỗi khi đọc file wallet: ${error.message}`, "error");
      return [];
    }
  }

  loadProxies() {
    try {
      const proxyFile = path.join(__dirname, "proxy.txt");
      if (fs.existsSync(proxyFile)) {
        return fs
          .readFileSync(proxyFile, "utf8")
          .replace(/\r/g, "")
          .split("\n")
          .filter(Boolean);
      }
      return [];
    } catch (error) {
      this.log(`Lỗi khi đọc file proxy: ${error.message}`, "error");
      return [];
    }
  }

  async makeRequest(config, proxy, maxRetries = 3, retryDelay = 5000) {
    let attempt = 1;
    while (attempt <= maxRetries) {
      try {
        if (proxy) {
          const proxyAgent = new HttpsProxyAgent(proxy);
          config.httpsAgent = proxyAgent;
        }

        const response = await axios(config);
        return response;
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        if (error.status !== 407) {
          this.log(
            `Lần thử ${attempt}/${maxRetries} thất bại: ${
              error.message
            }. Thử lại sau ${retryDelay / 1000}s...`,
            "warning"
          );
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        attempt++;
      }
    }
  }

  async checkProxyIP(proxy) {
    try {
      const proxyAgent = new HttpsProxyAgent(proxy);
      const response = await axios.get("https://api.ipify.org?format=json", {
        httpsAgent: proxyAgent,
        timeout: 10000,
      });
      if (response.status === 200) {
        return response.data.ip;
      } else {
        throw new Error(
          `Không thể kiểm tra IP của proxy. Status code: ${response.status}`
        );
      }
    } catch (error) {
      throw new Error(`Lỗi khi kiểm tra IP của proxy: ${error.message}`);
    }
  }

  async linkWallet(token, wallet, proxy) {
    const url = "https://api.paws.community/v1/user/wallet";
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.makeRequest(
        {
          method: "post",
          url: url,
          headers: headers,
          data: { wallet },
        },
        proxy
      );

      if (response.status === 201 && response.data.success) {
        return { success: true };
      } else {
        return { success: false, error: "Failed to link wallet" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  loadTokens() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        return JSON.parse(fs.readFileSync(this.tokenFile, "utf8"));
      }
      return {};
    } catch (error) {
      this.log(`Lỗi khi đọc file token: ${error.message}`, "error");
      return {};
    }
  }

  saveToken(userId, token) {
    this.tokens[userId] = token;
    try {
      fs.writeFileSync(this.tokenFile, JSON.stringify(this.tokens, null, 2));
      this.log(`Đã lưu token cho user ${userId}`, "success");
    } catch (error) {
      this.log(`Lỗi khi lưu token: ${error.message}`, "error");
    }
  }

  isExpired(token) {
    const [header, payload, sign] = token.split(".");
    const decodedPayload = Buffer.from(payload, "base64").toString();

    try {
      const parsedPayload = JSON.parse(decodedPayload);
      const now = Math.floor(DateTime.now().toSeconds());

      if (parsedPayload.exp) {
        const expirationDate = DateTime.fromSeconds(
          parsedPayload.exp
        ).toLocal();
        this.log(
          `Token hết hạn vào: ${expirationDate.toFormat("yyyy-MM-dd HH:mm:ss")}`
            .cyan
        );

        const isExpired = now > parsedPayload.exp;
        this.log(
          `Token đã hết hạn chưa? ${
            isExpired ? "Đúng rồi bạn cần thay token" : "Chưa..chạy tẹt ga đi"
          }`.cyan
        );

        return isExpired;
      } else {
        this.log(`Token vĩnh cửu không đọc được thời gian hết hạn`, "warning");
        return false;
      }
    } catch (error) {
      this.log(`Lỗi rồi: ${error.message}`, "error");
      return true;
    }
  }

  log(msg, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    switch (type) {
      case "success":
        console.log(`[${timestamp}] [*] ${msg}`.green);
        break;
      case "custom":
        console.log(`[${timestamp}] [*] ${msg}`.magenta);
        break;
      case "error":
        console.log(`[${timestamp}] [!] ${msg}`.red);
        break;
      case "warning":
        console.log(`[${timestamp}] [*] ${msg}`.yellow);
        break;
      default:
        console.log(`[${timestamp}] [*] ${msg}`.blue);
    }
  }

  async countdown(seconds) {
    for (let i = seconds; i >= 0; i--) {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`===== Chờ ${i} giây để tiếp tục vòng lặp =====`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    this.log("", "info");
  }

  async authenticate(initData, proxy) {
    const url = "https://api.paws.community/v1/user/auth";
    const payload = {
      data: initData,
      referralCode: initData.split("start_param=")[1].split("&")[0],
    };

    try {
      const response = await this.makeRequest(
        {
          method: "post",
          url: url,
          data: payload,
          headers: this.headers,
        },
        proxy
      );

      if (response.status === 201 && response.data.success) {
        const token = response.data.data[0];
        const userData = response.data.data[1];
        return {
          success: true,
          token: token,
          balance: userData.gameData.balance,
          username: userData.userData.username,
          firstname: userData.userData.firstname,
          wallet: userData.userData.wallet,
        };
      } else {
        return { success: false, error: "Authentication failed" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getUserInfo(token, proxy) {
    const url = "https://api.paws.community/v1/user";
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.makeRequest(
        {
          method: "get",
          url: url,
          headers: headers,
        },
        proxy
      );

      if (response.status === 200 && response.data.success) {
        const userData = response.data.data;
        return {
          success: true,
          balance: userData.gameData.balance,
          wallet: userData.userData.wallet,
        };
      } else {
        return { success: false, error: "Failed to get user info" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  validateWalletFile() {
    const dataFile = path.join(__dirname, "data.txt");
    const data = fs
      .readFileSync(dataFile, "utf8")
      .replace(/\r/g, "")
      .split("\n")
      .filter(Boolean);

    if (this.wallets.length !== data.length) {
      this.log(
        `Số lượng wallet (${this.wallets.length}) và data (${data.length}) không khớp nhau!`,
        "error"
      );
      return false;
    }

    if (this.proxies.length !== data.length) {
      this.log(
        `Số lượng proxy (${this.proxies.length}) và data (${data.length}) không khớp nhau!`,
        "error"
      );
      return false;
    }

    return true;
  }

  async getQuestsList(token, proxy) {
    const url = "https://api.paws.community/v1/quests/list";
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.makeRequest(
        {
          method: "get",
          url: url,
          headers: headers,
        },
        proxy
      );

      if (response.status === 200 && response.data.success) {
        return {
          success: true,
          data: response.data.data.filter((quest) => !quest.progress.claimed),
        };
      } else {
        return { success: false, error: "Failed to get quests list" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async completeQuest(token, questId, proxy) {
    const url = "https://api.paws.community/v1/quests/completed";
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.makeRequest(
        {
          method: "post",
          url: url,
          headers: headers,
          data: { questId },
        },
        proxy
      );

      const statusCode = response.status;
      const { success, data } = response.data;

      if (statusCode === 200 || statusCode === 201) {
        if (success) {
          return { success: true, data: data };
        } else {
          if (data === true) {
            this.log(
              `Nhiệm vụ ${questId} chưa hoàn thành, tiến hành claim...`,
              "info"
            );
            await this.claimQuest(token, questId, {
              title: `Quest ${questId}`,
              rewards: [{ amount: 0 }],
            });
          } else if (data === false) {
            this.log(
              `Chưa đủ điều kiện để hoàn thành nhiệm vụ ${questId}`,
              "warning"
            );
          }
        }
      } else {
        return { success: false, error: "Unexpected response status" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async claimQuest(token, questId, questData, proxy) {
    const url = "https://api.paws.community/v1/quests/claim";
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.makeRequest(
        {
          method: "post",
          url: url,
          headers: headers,
          data: { questId },
        },
        proxy
      );

      if (response) {
        const reward = questData.rewards[0].amount;
        this.log(
          `Làm nhiệm vụ ${questData.title} thành công | Phần thưởng : ${reward}`,
          "success"
        );
        return { success: true };
      } else {
        return { success: false, error: "Failed to claim quest reward" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async processQuests(token, proxy) {
    try {
      const questsResult = await this.getQuestsList(token, proxy);
      if (!questsResult.success) {
        this.log(
          `Lỗi khi lấy danh sách nhiệm vụ: ${questsResult.error}`,
          "error"
        );
        return;
      }

      const unclaimedQuests = questsResult.data;

      for (const quest of unclaimedQuests) {
        this.log(`Đang xử lý nhiệm vụ: ${quest.title}`, "info");

        const completeResult = await this.completeQuest(
          token,
          quest._id,
          proxy
        );
        if (!completeResult.success) {
          this.log(
            `Lỗi khi hoàn thành nhiệm vụ ${quest.title}: ${completeResult.error}`,
            "error"
          );
          continue;
        }

        const claimResult = await this.claimQuest(
          token,
          quest._id,
          quest,
          proxy
        );
        if (!claimResult.success) {
          this.log(
            `Lỗi khi nhận thưởng nhiệm vụ ${quest.title}: ${claimResult.error}`,
            "error"
          );
          continue;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      this.log(`Lỗi khi xử lý nhiệm vụ: ${error.message}`, "error");
    }
  }

  askQuestion(query) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) =>
      rl.question(query, (ans) => {
        rl.close();
        resolve(ans);
      })
    );
  }

  parseIframe = (iframe) => {
    return (
      iframe
        ?.replace(
          "https://app.paws.community/?tgWebAppStartParam=f5snhfYn#tgWebAppData=",
          ""
        )
        ?.replaceAll("%3D", "=")
        ?.replaceAll("%26", "&")
        ?.replaceAll("%25", "%")
        ?.replace(/&tgWebAppVersion.*/, "")
        ?.replace(/\r/g, "") || ""
    );
  };

  async main() {
    // if (!this.validateWalletFile()) {
    //   process.exit(1);
    // }

    const dataFile = path.join(__dirname, "data.txt");
    const data = fs
      .readFileSync(dataFile, "utf8")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => this.parseIframe(line))
      .filter(Boolean);
    // console.log("PawsClient ~ main ~ data:", data);
    this.log(
      "Tool được chia sẻ tại kênh telegram Dân Cày Airdrop (@dancayairdrop)"
        .green
    );

    // const nhiemvu = await this.askQuestion(
    //   "Bạn có muốn làm nhiệm vụ không? (y/n): "
    // );
    // const hoinhiemvu = nhiemvu.toLowerCase() === "y";
    const processPromises = data.map(async (dt, i) => {
      try {
        const initData = data[i];
        const userData = JSON.parse(
          decodeURIComponent(initData.split("user=")[1].split("&")[0])
        );
        const userId = userData.id;
        const firstName = userData.first_name;
        const walletAddress = this.wallets[i];
        const proxy_n = this.proxies[i];
        const [ip, port, username, password] = proxy_n.split(":");
        const proxy = `http://${username}:${password}@${ip}:${port}`;
        let proxyIP;
        try {
          proxyIP = await this.checkProxyIP(proxy);
          console.log(
            `========== Tài khoản ${i + 1} | ${firstName.green} | IP: ${
              proxyIP.cyan
            } ==========`
          );
        } catch (error) {
          this.log(
            `Lỗi proxy cho tài khoản ${i + 1}: ${error.message}`,
            "error"
          );
          // continue;
        }

        let userToken = this.tokens[userId];
        let needsNewToken = !userToken || this.isExpired(userToken);

        if (needsNewToken) {
          this.log(`Cần token mới cho user ${userId}`, "warning");
          const authResult = await this.authenticate(initData, proxy);
          if (authResult.success) {
            userToken = authResult.token;
            this.saveToken(userId, userToken);
            this.log(
              `Balance: ${authResult.balance.toString().magenta}`,
              "custom"
            );

            if (true) {
              this.log(
                `Tài khoản đã liên kết với ví: ${authResult.wallet}`,
                "success"
              );
            } else {
              this.log(
                `Tài khoản chưa liên kết ví. Tiến hành liên kết...`,
                "warning"
              );
              const linkResult = await this.linkWallet(
                userToken,
                walletAddress,
                proxy
              );
              if (linkResult.success) {
                this.log(
                  `Đã liên kết ví thành công: ${walletAddress}`,
                  "success"
                );
              } else {
                this.log(`Lỗi khi liên kết ví: ${linkResult.error}`, "error");
              }
            }
          } else {
            this.log(
              `Đăng nhập không thành công! ${authResult.error}`,
              "error"
            );
            // continue;
          }
        } else {
          this.log(`Sử dụng token hiện có cho user ${userId}`, "info");
          const userInfo = await this.getUserInfo(userToken, proxy);
          if (userInfo.success) {
            this.log(
              `Balance: ${userInfo.balance.toString().magenta}`,
              "custom"
            );

            if (true) {
              this.log(
                `Tài khoản đã liên kết với ví: ${userInfo.wallet}`,
                "success"
              );
            } else {
              this.log(
                `Tài khoản chưa liên kết ví. Tiến hành liên kết...`,
                "warning"
              );
              const linkResult = await this.linkWallet(
                userToken,
                walletAddress,
                proxy
              );
              if (linkResult.success) {
                this.log(
                  `Đã liên kết ví thành công: ${walletAddress}`,
                  "success"
                );
              } else {
                this.log(`Lỗi khi liên kết ví: ${linkResult.error}`, "error");
              }
            }
          } else {
            this.log(`Lỗi khi lấy thông tin user: ${userInfo.error}`, "error");
          }
        }
        if (true) {
          this.log(`Đang kiểm tra nhiệm vụ...`, "info");
          await this.processQuests(userToken, proxy);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(error);
      }
    });

    await Promise.all(processPromises);
  }
}

const client = new PawsClient();
client.main().catch((err) => {
  client.log(err.message, "error");
  process.exit(1);
});
