// @flow
import { computed } from "mobx";
import BaseModel from "./BaseModel";

class Team extends BaseModel {
  id: string;
  name: string;
  avatarUrl: string;
  slackConnected: boolean;
  googleConnected: boolean;
  oauthConnected: boolean;
  sharing: boolean;
  documentEmbeds: boolean;
  guestSignin: boolean;
  subdomain: ?string;
  url: string;

  @computed
  get signinMethods(): string {
    if(this.oauthConnected) {
      return "Oauth Provider";
    }
    if (this.slackConnected && this.googleConnected) {
      return "Slack, Google";
    }
    if (this.slackConnected) return "Slack";
    return "Google";
  }
}

export default Team;
